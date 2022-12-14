import { lookupArchive, KnownArchives } from '@subsquid/archive-registry';
import {
  BatchContext,
  BatchProcessorItem,
  SubstrateBatchProcessor,
  BatchProcessorCallItem
} from '@subsquid/substrate-processor';
import { Store, TypeormDatabase } from '@subsquid/processor-tools';
import { Totals, HistoricalDataMeta, SubProcessorTask } from './model';

import { getParsedEventsData } from './mappers/common';
import { handleChainHolders } from './mappers/holders';
import { BatchBlock } from '@subsquid/substrate-processor/src/processor/batchProcessor';
import { handleTotalIssuance } from './mappers/issuance';
import { handleFinalizedBlock } from './mappers/finalizedBlocks';
import { handleValidators } from './mappers/validator';
import { handleStakeAmount } from './mappers/staking';
import { handleTransfers } from './mappers/transfers';
import {
  BlockEventName,
  BalancesTransferEventData,
  CallSignedExtrinsicData
} from './utils/types';
import { handleExtrinsics } from './mappers/extrinsics';
import { getChain } from './chains';
import { TreadsPool } from './subProcessor';

const chainConfig = getChain();

const processor = new SubstrateBatchProcessor()
  .setDataSource({
    archive: lookupArchive(chainConfig.config.chainName as KnownArchives, {
      release: 'FireSquid'
    }),
    chain: chainConfig.config.dataSource.chain
  })
  .setBlockRange(chainConfig.config.blockRange || { from: 0 })
  .includeAllBlocks()
  .addEvent('Balances.Transfer', {
    data: { event: { extrinsic: true, args: true } }
  } as const)
  .addCall('*', {
    data: {
      extrinsic: true
    }
  });

export type Item = BatchProcessorItem<typeof processor>;
export type CallItem = BatchProcessorCallItem<typeof processor>;
export type Ctx = BatchContext<Store, Item>;
export type Block = BatchBlock<Item>;

processor.run(new TypeormDatabase(), async (ctx) => {
  const tasksPool = TreadsPool.getInstance(ctx);
  const parsedEvents = getParsedEventsData(ctx);
  ctx.store.deferredLoad(Totals, '1');
  ctx.store.deferredLoad(HistoricalDataMeta, '1');
  ctx.store.deferredLoad(SubProcessorTask);
  await ctx.store.load();
  tasksPool.setResultsProcessingWindow(true);
  await tasksPool.ensureTasksQueue();

  for (let block of ctx.blocks) {
    await handleFinalizedBlock(ctx, block);
    await handleValidators(ctx, block);
    await handleChainHolders(ctx, block);
    await handleTotalIssuance(ctx, block);
    await handleStakeAmount(ctx, block);
  }
  await handleTransfers(
    ctx,
    parsedEvents.getBySection<BalancesTransferEventData>(
      BlockEventName.BALANCES_TRANSFER
    )
  );
  await handleExtrinsics(
    ctx,
    parsedEvents.getBySection<CallSignedExtrinsicData>(
      BlockEventName.SIGNED_EXTRINSIC
    )
  );
  tasksPool.setResultsProcessingWindow(false);
});
