import { expect, it } from 'vitest';
import { captureOwnerKey, nativeCaptureReference } from '@/lib/audio/capture-owner';

it('places equal capture IDs in different account namespaces', async () => {
  const alice = await captureOwnerKey('account-a');
  const bob = await captureOwnerKey('account-b');
  expect(alice).not.toEqual(bob);
  expect(await captureOwnerKey('account-a')).toEqual(alice);
  expect(nativeCaptureReference(alice, 'cap_1', 'wav')).not.toEqual(
    nativeCaptureReference(bob, 'cap_1', 'wav'),
  );
  await expect(captureOwnerKey(null)).rejects.toThrow('active account');
});

it.each(['', '../x', 'cap/2', 'cap\n', '%2e%2e'])('rejects unsafe capture ID %s', (id) => {
  expect(() => nativeCaptureReference('a'.repeat(64), id, 'wav')).toThrow();
});

it.each(['../escape', 'A'.repeat(64), 'a'.repeat(63), 'a'.repeat(64) + '\n'])(
  'rejects invalid owner key %s',
  (owner) => expect(() => nativeCaptureReference(owner, 'cap_1', 'wav')).toThrow(),
);
