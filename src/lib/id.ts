import { customAlphabet } from "nanoid";

const alphabet = "0123456789abcdefghijkmnopqrstuvwxyz";
const short = customAlphabet(alphabet, 14);
const long = customAlphabet(alphabet + "ABCDEFGHJKLMNPQRSTUVWXYZ", 40);

/** Prefixed, URL-safe ids: `mon_7h2k...`. The prefix makes logs readable. */
export const newId = (prefix: string) => `${prefix}_${short()}`;

/** Unguessable secret, e.g. for signing webhook bodies. */
export const newSecret = () => `whsec_${long()}`;
