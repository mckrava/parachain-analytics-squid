import * as dotenv from 'dotenv';
// dotenv.config();
dotenv.config({ path: `${__dirname}/../.env.local` });

export const checkPointKeys = new Map([
  ['holders', 1000 * 60 * 60],
  ['issuance', 1000 * 60 * 60],
  ['staking', 1000 * 60 * 60],
  ['validators', 1000 * 60 * 60]
]);

export const processorConfig = {
  chainName: 'kusama',
  prefix: 'kusama',
  dataSource: {
    archive: 'https://kusama.archive.subsquid.io/graphql',
    chain: process.env.ONFINALITY_KUSAMA_ENDPOINT
  },
  typesBundle: 'kusama',
  batchSize: 50,
  blockRange: {
    from: 100000
  }
};
