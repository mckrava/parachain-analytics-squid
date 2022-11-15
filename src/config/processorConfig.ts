import { SubstrateProcessor } from '@subsquid/substrate-processor';
import { KnownArchives } from '@subsquid/archive-registry';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Parameters<T> = T extends (...args: infer T) => any ? T : never;

enum HandlerParams {
  NAME,
  OPTIONS,
  FUNC
}

export type IntervalsConfig = Map<string, number>;

export type SourceConfig = {
  chainName: KnownArchives;
  prefix: number | string;
  dataSource: Parameters<
    SubstrateProcessor<any>['setDataSource']
  >[HandlerParams.NAME];
};

export interface ProcessorConfig {
  srcConfig: SourceConfig;
  intervalsConfig: IntervalsConfig;
}
