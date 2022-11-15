// import {ChainGetters} from './chainGetters'
//
// export function getGetters(): ChainGetters {
//     switch (process.env.CHAIN) {
//         case 'kusama':
//             return require('./kusama').default
//         case 'polkadot':
//             return require('./polkadot').default
//         case 'acala':
//             return require('./acala').default
//         case 'moonriver':
//             return require('./moonriver').default
//         case 'moonbeam':
//             return require('./moonbeam').default
//         case 'crust':
//             return require('./crust').default
//         case 'bifrost':
//             return require('./bifrost').default
//         case 'phala':
//             return require('./phala').default
//         default:
//             throw new Error(`Unsupported chain ${process.env.CHAIN}`)
//     }
// }
