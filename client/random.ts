import { type RandomSource, createCryptoRandom } from '@shared/random';

/** The secure random source used for player rolls on this device. */
export const secureRandom: RandomSource = createCryptoRandom((array) => crypto.getRandomValues(array));
