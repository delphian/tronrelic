/**
 * Address Book Seed Data.
 *
 * Human-readable names for known TRON addresses including energy rental pools,
 * exchanges, and notable accounts. This data is seeded during plugin installation
 * and can be extended via the admin UI.
 *
 * Without this seed data, pool names display as raw 34-character addresses.
 */

import type { IAddressBookEntry } from '../shared/types/index.js';

/**
 * Seed data for the address book collection.
 *
 * Categories:
 * - pool: Energy rental pools and their billing/pool addresses
 * - exchange: Centralized exchanges
 * - notable: Notable addresses (staking, black holes, influential accounts)
 */
export const ADDRESS_BOOK_SEED_DATA: Omit<IAddressBookEntry, 'createdAt' | 'updatedAt'>[] = [
    // Energy Rental Pools
    { address: 'TEMkRxLtCCdL4BCwbPXbbNWe4a9gtJ7kq7', name: 'Tron Energy Market', category: 'pool' },
    { address: 'TGNuLPkkgsf42xdRSXYpVSqUvtFT4HEupg', name: 'Feee.io Pool', category: 'pool' },
    { address: 'TUeq6WKpJZXMDQ4PgnMgL1xVTAETBAQo9f', name: 'Feee.io', category: 'pool' },
    { address: 'TYoAtLwBpWbknJuL4ACW6oXm4AVVbPRXDH', name: 'Feee.io C2C', category: 'pool' },
    { address: 'TMq4o2LTj13WqcTCc2GCyuBwWAxnvsBD2v', name: 'Feee.io B2B', category: 'pool' },
    { address: 'TXUwRhntqX3kyALhtpC74JP8Nt6m2VMiYC', name: 'Tron Save Pool', category: 'pool' },
    { address: 'TWZEhq5JuUVvGtutNgnRBATbF8BnHGyn4S', name: 'Tron Save', category: 'pool' },
    { address: 'TBu4CN53XnwBPE93FNLnEsbMsqSs2Mw4kM', name: 'Tron Pulse', category: 'pool' },
    { address: 'TH2uNFtnwr5NsiAW2Py6Fmv8zDhfYXyDd9', name: 'Tron Pulse', category: 'pool' },
    { address: 'TLwpQv9N6uXZQeE4jUudLPjcRffbXXAuru', name: 'Tron Energize', category: 'pool' },
    { address: 'TKHgPuoqW4XNGJtwuFwExA7hcUdTkwcLXn', name: 'Nitron Energy', category: 'pool' },
    { address: 'TXYqcWRnNP1bGsa9tzjsEJiKAYwMRonwMv', name: 'Tronify', category: 'pool' },
    { address: 'TQ9KMdd6xkP8HqwmAL7dmT45YifyaAm6CZ', name: 'Tron Lending', category: 'pool' },
    { address: 'TP3cCMDakVnVseoWTAz3ZDfEB8CtCxKZbi', name: 'Energy Father', category: 'pool' },
    { address: 'TUfAMQM81RLMdquBSaFytsXxEet7AKKKKK', name: 'MeFree.Net', category: 'pool' },
    { address: 'TGp6j1rJGzozKFNecphmaksKTF8veooooo', name: 'MeFree.Net Pool', category: 'pool' },
    { address: 'TBzCv4dEX4N3VewR3pDifLWNT8dbGyfrou', name: 'Tron NRG', category: 'pool' },
    { address: 'TCMrBZoSt3Q4egHzd7ga21JCdZH7n3EEEE', name: 'Tron Fee Energy Rental', category: 'pool' },
    { address: 'TEX5nLeFJ1dyazhJC3P9eYJs7hxgk7knJY', name: 'Tron Energy Billing', category: 'pool' },
    { address: 'TY2sHGWPjJhrS1b7ufBwH1BXppBRmPpkCz', name: 'Tron Energy Pool', category: 'pool' },
    { address: 'TX5PK3Y7qovSQxQBH9auxwqq66LJzn2eAt', name: '1TRXU.com', category: 'pool' },
    { address: 'TW2AHs6stcc1QwjtaXbeTxW4tDUBT77777', name: 'TronEngTrx.com', category: 'pool' },
    { address: 'TVMQXnvXa1UWKReLtD8AEMcf4azb2ZP99u', name: 'trxusdt.com', category: 'pool' },
    { address: 'TUyYkdiKNopiWFX33mSkwkmpYmrNwAor8j', name: 'foxupay', category: 'pool' },
    { address: 'TLTiLoxkGXX9QZ1PeJbNLkjjLxhrH99999', name: 'X-Freepay', category: 'pool' },
    { address: 'TEv8umGWXrwh2FFuZRYELGv9jpcNNAhCBb', name: 'Tron energy-sharing', category: 'pool' },
    { address: 'TRkhUSi3dPNTDRpL5Qe28tLhz6XSs22222', name: 'trxus.com', category: 'pool' },
    { address: 'TEUnJw4ZkiFqZ2NBz5DbWDkaJJEEvAAAAA', name: 'trxyes.com', category: 'pool' },
    { address: 'TWHjkeWDmWjXRi7dbvyaTLnRQranux2BzL', name: 'trxres.com Pool', category: 'pool' },
    { address: 'TTvDaNWWGRWUa4nEwnaM88bPvPiF4RuR4T', name: 'trxres.com', category: 'pool' },
    { address: 'TQCeP7EEAxoeqW6DeUaf2biviYDa9zAbMW', name: 'TRX369', category: 'pool' },
    { address: 'TCSfU1SAhA1wfEu14ruTtEfUQCUYBjTQc5', name: 'Trongas Energy', category: 'pool' },
    { address: 'TGiHbJ79MYaH8UdEWww7EXff2WHMTgSoHu', name: 'SoHu TG Bot', category: 'pool' },
    { address: 'TQ9unuoNF4bfZR34xYZxPem5H11cTtzUqd', name: 'trxx.io Billing', category: 'pool' },
    { address: 'TDYPFoZ2Q6aY9kpVbLTcQycuhCEKsNYMFX', name: 'trxx.io Pool', category: 'pool' },
    { address: 'TT41TcG5X6UCcsEZvcryiHs4TtR576e65q', name: 'freee.vip Pool', category: 'pool' },
    { address: 'TWCT8uRHLuRChPVnZYj8KNmgyrFE5KgjrE', name: 'freee.vip Billing', category: 'pool' },
    { address: 'TPPk6k3c5PLzp2QexcDbaKWscJJsZL93bA', name: 'foxupay.com Billing', category: 'pool' },
    { address: 'TAypYEBPxxmKgiDdYR1HvxWTpzTaiRvyve', name: 'foxupay.com Pool', category: 'pool' },
    { address: 'TAJiN1EeJ3YaSetVjkZa4xam9JGhr8zE5A', name: 'neee.cc Pool', category: 'pool' },
    { address: 'TJRxLPZHbNmcqhiJBHNxxnq6n4oobwWVtt', name: 'tron.energy (All)', category: 'pool' },
    { address: 'TRR28kzdZnPcXYzR2YzJYbR2MJdweb2CP3', name: 'trondealer.com', category: 'pool' },
    { address: 'TTrAuTra99HB9kekjM3AabSeqrshXzjcGW', name: 'ippp.io Billing', category: 'pool' },
    { address: 'TFsZdoEqhg7TAMeMQTMQ2nnqYictbpmrSs', name: 'ippp.io Pool', category: 'pool' },
    { address: 'TJjUZhmEPFMneBMfbGmZnQeZXDR7Q77777', name: 'avvv.io Pool', category: 'pool' },
    { address: 'THsm8tYpDM3Ru3SAnPg6Vsnuxfxy3F2222', name: 'avvv.io Billing', category: 'pool' },
    { address: 'TXLYbwws847CsHVetLPRYecyqE4s666666', name: 'apitrx.com Billing', category: 'pool' },
    { address: 'TZ33cAAURYz2qSUGB4bzKLiedg9wuMsSas', name: 'apitrx.com Pool', category: 'pool' },

    // Exchanges
    { address: 'TDqSquXBgUCLYvYC4XZgrprLK589dkhSCf', name: 'Binance', category: 'exchange' },
    { address: 'TV6MuMXfmLbBqPZvBHdwFsDnQeVfnmiuSi', name: 'Binance', category: 'exchange' },
    { address: 'TAzsQ9Gx8eqFNFSKbeXrbi45CuVPHzA8wr', name: 'Binance', category: 'exchange' },
    { address: 'TJDENsfBJs4RFETt1X1W8wMDc8M5XnJhCe', name: 'Binance', category: 'exchange' },
    { address: 'TNXoiAJ3dct8Fjg4M9fkLFh9S2v9TXc32G', name: 'Binance', category: 'exchange' },
    { address: 'TYASr5UV6HEcXatwdFQfmLVUqQQQMUxHLS', name: 'Binance', category: 'exchange' },
    { address: 'TQrY8tryqsYVCYS3MFbtffiPp2ccyn4STm', name: 'Binance', category: 'exchange' },
    { address: 'TAUN6FwrnwwmaEqYcckffC7wYmbaS6cBiX', name: 'Binance', category: 'exchange' },
    { address: 'TT1DyeqXaaJkt6UhVYFWUXBXknaXnBudTK', name: 'Binance', category: 'exchange' },
    { address: 'TWd4WrZ9wn84f5x1hZhL4DHvk738ns5jwb', name: 'Binance', category: 'exchange' },
    { address: 'TJCo98saj6WND61g1uuKwJ9GMWMT9WkJFo', name: 'Binance', category: 'exchange' },
    { address: 'TMuA6YqfCeX8EhbfYEg5y7S4DqzSJireY9', name: 'Binance', category: 'exchange' },
    { address: 'TNPdqto8HiuMzoG7Vv9wyyYhWzCojLeHAF', name: 'Binance', category: 'exchange' },
    { address: 'TTd9qHyjqiUkfTxe3gotbuTMpjU8LEbpkN', name: 'Kraken', category: 'exchange' },
    { address: 'TBbxwsCtjsMQh2zKKjsu6rd85FDVkLDcCh', name: 'Kraken', category: 'exchange' },
    { address: 'TUpHuDkiCCmwaTZBHZvQdwWzGNm5t8J2b9', name: 'KuCoin', category: 'exchange' },
    { address: 'TUN4dKBLbAZjArUS7zYewHwCYA6GSUeSaK', name: 'KuCoin', category: 'exchange' },
    { address: 'TRYL7PKCG4b4xRCM554Q5J6o8f1UjUmfnY', name: 'KuCoin', category: 'exchange' },
    { address: 'TEWzF5ZsaWMh6sTNDPrYaPJrK8TTMGfwCC', name: 'KuCoin', category: 'exchange' },
    { address: 'TLWE45u7eusdewSDCjZqUNmyhTUL1NBMzo', name: 'KuCoin', category: 'exchange' },

    // Notable Addresses
    { address: 'TU3kjFuhtEo42tsCBtfYUAZxoqQ4yuSLQ5', name: 'sTRX', category: 'notable' },
    { address: 'T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb', name: '[Black Hole]', category: 'notable' },
    { address: 'TPyjyZfsYaXStgz2NmAraF1uZcMtkgNan5', name: 'Justin Sun', category: 'notable' },
    { address: 'TT2T17KZhoDu47i2E4FWxfG79zdkEWkU9N', name: 'Justin Sun', category: 'notable' },
    { address: 'TU32XvjDNkxEkqxCgQQWEKmoMxTz8NECUV', name: 'Justin Sun', category: 'notable' }
];
