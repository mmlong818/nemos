import type { DocProtection } from './types';
/** Generate the protection password hash (random 16-byte salt, 100000 iterations by default) */
export declare function hashProtectionPassword(password: string, spinCount?: number): Promise<{
    hash: string;
    salt: string;
    spinCount: number;
    algorithmSid: number;
}>;
/** Check whether the password matches the hash in documentProtection (no hash = no password, always true) */
export declare function verifyProtectionPassword(password: string, protection: Pick<DocProtection, 'hash' | 'salt' | 'spinCount' | 'algorithmSid'>): Promise<boolean>;
