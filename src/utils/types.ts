export enum BlockEventName {
  BALANCES_TRANSFER = "BALANCES_TRANSFER",
}

export interface BalancesTransferEventData {
  id: string;
  blockNumber: bigint;
  timestamp: Date;
  amount: bigint;
}

export type ParsedEventsData = BalancesTransferEventData;

export type ParsedEventsDataMap = Map<BlockEventName, Set<ParsedEventsData>>;
