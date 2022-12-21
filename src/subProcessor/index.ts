import path from 'path';
import {
  SubProcessorTaskPayload,
  SubProcessorTaskResult
} from '../utils/types';
import { Ctx } from '../processor';
import { SubProcessorTask, SubProcessorTaskStatus, TaskResult } from '../model';
import { WorkersPool } from './workersPool';
import { getChain } from '../chains';

const { config: chainConfig } = getChain();

export class TreadsPool {
  private static instance: TreadsPool;

  private workersPool: WorkersPool;
  private poolOptions = {
    filename: path.resolve(__dirname, './subProcessorCore'),
    maxThreads: chainConfig.subProcessor
      ? chainConfig.subProcessor.maxThreads
      : 10
  };

  private prometheusPost: number = 3005;
  private isInstanceHealthy: boolean = false;
  private resultsProcessingWindowOpen: boolean = false;
  /**
   * Scope of ordered lists with tasks results. Each list contains results of
   * tasks which are located from the beginning of tasksQueue list.
   * (e.g.
   *    - case #1: tasksQueue = [t#1, t#2, t#3], resultsStackCache = {res_t#2}, _resultsListsScope = []
   *    - case #2: tasksQueue = [t#1, t#2, t#3], resultsStackCache = {res_t#1, res_t#2}, _resultsListsScope = [res_t#1, res_t#2]
   * )
   */
  private _resultsListsScope: Map<string, Array<SubProcessorTaskResult<''>>> =
    new Map();

  /**
   * Cache of completed tasks results which are already completed but cannot be
   * provided to client as task in previous position in tasksQueue still is
   * in processing.
   */
  private resultsStackCache: Map<
    string,
    Map<string, SubProcessorTaskResult<''>>
  > = new Map();

  private resultsBuffer: Map<string, Map<string, SubProcessorTaskResult<''>>> =
    new Map();

  private constructor(private context: Ctx) {
    this.workersPool = new WorkersPool(this.poolOptions);
  }

  private ensureResultsListsScopeContainer(taskName: string) {
    if (!this._resultsListsScope.has(taskName))
      this._resultsListsScope.set(taskName, []);
  }
  private ensureResultsStackCacheContainer(taskName: string) {
    if (!this.resultsStackCache.has(taskName))
      this.resultsStackCache.set(taskName, new Map());
  }

  static getInstance(ctx: Ctx) {
    if (!TreadsPool.instance) {
      TreadsPool.instance = new TreadsPool(ctx);
    }
    return TreadsPool.instance;
  }

  /**
   * Set marker when all entities are fetched and available in store
   * cache and batch processing flow is not completed.
   * @param status
   */
  setResultsProcessingWindow(status: boolean) {
    this.resultsProcessingWindowOpen = status;
  }

  getResultsListByTaskName(taskName: string): Array<unknown> {
    return this._resultsListsScope.get(taskName) || [];
  }

  private async addTaskResultsToTmpBuffer(resData: SubProcessorTaskResult<''>) {
    if (!this.resultsBuffer.has(resData.taskName))
      this.resultsBuffer.set(resData.taskName, new Map());

    this.resultsBuffer.get(resData.taskName)!.set(resData.id, resData);
  }

  private async addTaskResultsToStack(resData: SubProcessorTaskResult<''>) {
    this.ensureResultsStackCacheContainer(resData.taskName);
    this.resultsStackCache.get(resData.taskName)!.set(resData.id, resData);

    let taskEntity = await this.context.store.get(
      SubProcessorTask,
      resData.id,
      false
    );
    if (!taskEntity) {
      throw Error(
        `SubProcessorTask entity with id ${resData.id} can not be found.`
      );
    }
    taskEntity.status = SubProcessorTaskStatus.completed;
    taskEntity.result = resData.result
      ? new TaskResult({
          // @ts-ignore
          totalHoldersCount: resData.result.totalHoldersCount ?? null,
          // @ts-ignore
          totalFreeBalance: resData.result.totalFreeBalance ?? null
        })
      : null;
    this.context.store.deferredUpsert(taskEntity);

    /**
     * Run process of migration results from cache to results list for access by
     * final user/function.
     */
    this.moveTaskResultToResultsList(resData.taskName);
  }

  private moveTaskResultToResultsList(taskName: string) {
    this.ensureResultsStackCacheContainer(taskName);
    this.ensureResultsListsScopeContainer(taskName);

    const currentTaskQueue = getOrderTasksListByIndexAndSubIndex(
      [...this.context.store.values(SubProcessorTask)].filter(
        (t) => t.taskName === taskName
      )
    );

    const currentTaskResCache = this.resultsStackCache.get(taskName)!;
    const currentResultsList = this._resultsListsScope.get(taskName)!;

    for (const i of currentTaskQueue) {
      if (currentTaskResCache.has(currentTaskQueue[0].id)) {
        const task = currentTaskQueue.shift() as SubProcessorTaskResult<''>;
        currentResultsList.push(currentTaskResCache.get(task.id)!);
        currentTaskResCache.delete(task.id);
        this.context.store.deferredRemove(task);
      }
    }
    this.resultsStackCache.set(taskName, currentTaskResCache);
    this._resultsListsScope.set(
      taskName,
      currentResultsList.filter((r) => !r.terminated)
    );
  }

  /**
   * Clear results list for specific task name after user ingested this data
   * for further processing.
   * @param taskName
   */
  async clearTaskResultsListByTaskName(taskName: string) {
    this._resultsListsScope.delete(taskName);
  }

  async addTask(taskPayload: SubProcessorTaskPayload) {
    const {
      id,
      taskName,
      blockHash,
      blockHeight,
      timestamp,
      queueIndex,
      queueSubIndex
    } = taskPayload;

    this.context.store.deferredUpsert(
      new SubProcessorTask({
        id,
        taskName: taskName,
        blockHash: blockHash,
        blockHeight: blockHeight,
        timestamp: timestamp.toString(),
        status: SubProcessorTaskStatus.waiting,
        queueIndex: queueIndex,
        queueSubIndex: queueSubIndex
      })
    );

    await this.processTasksQueue();
  }

  async processTasksQueue() {
    this.isInstanceHealthy = true;

    this.context.log
      .child('sub-processors manager')
      .info(
        `Number of workers in use - ${this.workersPool.workersList.length}`
      );

    if (!this.workersPool.isFreeWorkerAvailable()) return;

    const orderedTasks = getOrderTasksListByIndexAndSubIndex(
      [...this.context.store.values(SubProcessorTask)].filter(
        (t) => t.status === SubProcessorTaskStatus.waiting
      )
    );

    if (orderedTasks.length === 0) return;

    const newTaskPayload = orderedTasks[0];

    const workerId = await this.workersPool.run(
      {
        id: newTaskPayload.id,
        taskName: newTaskPayload.taskName,
        blockHash: newTaskPayload.blockHash,
        blockHeight: newTaskPayload.blockHeight,
        promPort: this.getPrometheusPort()
      },
      async (message: unknown) => {
        if (this.resultsProcessingWindowOpen) {
          this.context.log
            .child('sub-processors manager')
            .info('Store availability WINDOW OPEN');
          // await this.moveTaskResultToResultsList({
          await this.addTaskResultsToStack({
            ...newTaskPayload,
            // @ts-ignore
            result: message
          });
          await this.processTasksQueue();
        } else {
          this.context.log
            .child('sub-processors manager')
            .warn('Store availability WINDOW CLOSE');
          await this.addTaskResultsToTmpBuffer({
            ...newTaskPayload,
            // @ts-ignore
            result: message
          });
        }
      }
    );

    newTaskPayload.workerId = workerId;
    newTaskPayload.status = SubProcessorTaskStatus.processing;
    this.context.store.deferredUpsert(newTaskPayload);

    await this.processTasksQueue();
  }

  async ensureTasksQueue() {
    const existingSavedTasks = [...this.context.store.values(SubProcessorTask)];

    for (const [taskName, results] of [...this.resultsBuffer.entries()]) {
      for (const res of [...results.values()]) {
        await this.addTaskResultsToStack(res);
      }
    }
    this.resultsBuffer.clear();

    if (
      existingSavedTasks.length === 0 ||
      (existingSavedTasks.length > 0 && this.isInstanceHealthy)
    ) {
      await this.processTasksQueue();
      return;
    }

    this.context.log.child('sub-processors manager').info('TASKS QUEUE ENSURE');

    const availableTaskNames = new Set<string>();

    for (let i = 0; i < existingSavedTasks.length; i++) {
      availableTaskNames.add(existingSavedTasks[i].taskName);
      if (existingSavedTasks[i].status === SubProcessorTaskStatus.processing) {
        existingSavedTasks[i].status = SubProcessorTaskStatus.waiting;
        this.context.store.deferredUpsert(existingSavedTasks[i]);
      } else if (
        existingSavedTasks[i].status === SubProcessorTaskStatus.completed
      ) {
        this.ensureResultsStackCacheContainer(existingSavedTasks[i].taskName);
        this.resultsStackCache
          .get(existingSavedTasks[i].taskName)!
          .set(existingSavedTasks[i].id, {
            id: existingSavedTasks[i].id,
            taskName: existingSavedTasks[i].taskName,
            blockHash: existingSavedTasks[i].blockHash,
            blockHeight: existingSavedTasks[i].blockHeight,
            timestamp: existingSavedTasks[i].timestamp,
            // @ts-ignore
            result: existingSavedTasks[i].result ?? null,
            queueIndex: existingSavedTasks[i].queueIndex,
            queueSubIndex: existingSavedTasks[i].queueSubIndex
          });
      }
    }

    availableTaskNames.forEach((taskName) =>
      this.moveTaskResultToResultsList(taskName)
    );

    await this.processTasksQueue();
  }

  private getPrometheusPort(): number {
    // TODO add port availability detection

    if (this.prometheusPost < 3999) return this.prometheusPost++;

    this.prometheusPost = 3001;
    return this.prometheusPost;
  }
}

function getOrderEntitiesListByIndex(
  entitiesMap: Map<number, SubProcessorTask>
) {
  return [...entitiesMap.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : b[0] < a[0] ? 1 : 0))
    .map((item) => item[1]);
}

function getOrderTasksListByIndexAndSubIndex(entitiesList: SubProcessorTask[]) {
  return entitiesList.sort((a, b) => {
    if (a.queueIndex === b.queueIndex) {
      return a.queueSubIndex < b.queueSubIndex ? -1 : 1;
    } else {
      return a.queueIndex < b.queueIndex ? -1 : 1;
    }
  });
}
