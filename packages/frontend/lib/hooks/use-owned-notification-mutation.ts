import { useCallback, useLayoutEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import {
  useMutation,
  useQueryClient,
  type MutateOptions,
  type UseMutateAsyncFunction,
  type UseMutateFunction,
} from '@tanstack/react-query';
import { useOxy } from '@oxy.so/services/ui/client';
import { oxyServices as apiOwner } from '../oxy';

type Owner = {
  viewerId: string | undefined;
  sessionId: string | null;
  epoch: number;
  services: typeof apiOwner;
};
type OwnedVariables<T> = { owner: Owner; value: T; invokedWhileOwned: boolean };

/** Bind each invocation to the committed account that created its public callback. */
export function useOwnedNotificationMutation<T>(
  action: (value: T, viewerId: string) => Promise<unknown>,
) {
  const { oxyServices, isAuthenticated, user, activeSessionId } = useOxy();
  const queryClient = useQueryClient();
  const subscribe = useCallback(
    (listener: () => void) => oxyServices.http.addTokenChangeListener(listener),
    [oxyServices],
  );
  const getEpoch = useCallback(() => oxyServices.http.getSessionEpoch(), [oxyServices]);
  const epoch = useSyncExternalStore(subscribe, getEpoch, getEpoch);
  const viewerId = isAuthenticated ? user?.id : undefined;
  const owner = useMemo<Owner>(
    () => ({ viewerId, sessionId: activeSessionId ?? null, epoch, services: oxyServices }),
    [viewerId, activeSessionId, epoch, oxyServices],
  );
  const committed = useRef<Owner | null>(null);
  useLayoutEffect(() => {
    committed.current = owner;
    return () => {
      if (committed.current === owner) committed.current = null;
    };
  }, [owner]);

  const sameSession = (candidate: Owner) =>
    candidate.services === apiOwner &&
    !!candidate.viewerId &&
    candidate.services.session.userId === candidate.viewerId &&
    candidate.services.http.getSessionEpoch() === candidate.epoch;
  const owns = (candidate: Owner) => committed.current === candidate && sameSession(candidate);
  // An invocation already accepted on screen may finish after navigation, but
  // a different committed owner or changed bearer must still stop a retry.
  const mayContinue = (candidate: Owner) =>
    (committed.current === candidate || committed.current === null) && sameSession(candidate);

  const mutation = useMutation<unknown, Error, OwnedVariables<T>>({
    mutationFn: ({ owner: requestOwner, value, invokedWhileOwned }) => {
      if (!invokedWhileOwned || !mayContinue(requestOwner) || !requestOwner.viewerId)
        throw new Error('The active account changed');
      return action(value, requestOwner.viewerId);
    },
    onSuccess: (_data, { owner: requestOwner, invokedWhileOwned }) => {
      if (invokedWhileOwned && mayContinue(requestOwner)) {
        void queryClient.invalidateQueries({ queryKey: ['notifications', requestOwner.viewerId] });
      }
    },
  });

  const callbacks = (options: MutateOptions<unknown, Error, T> | undefined, value: T) =>
    options && {
      onSuccess: (
        data: unknown,
        _variables: OwnedVariables<T>,
        result: unknown,
        context: Parameters<NonNullable<typeof options.onSuccess>>[3],
      ) => {
        if (owns(owner)) options.onSuccess?.(data, value, result, context);
      },
      onError: (
        error: Error,
        _variables: OwnedVariables<T>,
        result: unknown,
        context: Parameters<NonNullable<typeof options.onError>>[3],
      ) => {
        if (owns(owner)) options.onError?.(error, value, result, context);
      },
      onSettled: (
        data: unknown,
        error: Error | null,
        _variables: OwnedVariables<T>,
        result: unknown,
        context: Parameters<NonNullable<typeof options.onSettled>>[4],
      ) => {
        if (owns(owner)) options.onSettled?.(data, error, value, result, context);
      },
    };
  const mutate: UseMutateFunction<unknown, Error, T> = (value, options) => {
    mutation.mutate({ owner, value, invokedWhileOwned: owns(owner) }, callbacks(options, value));
  };
  const mutateAsync: UseMutateAsyncFunction<unknown, Error, T> = async (value, options) => {
    const result = await mutation.mutateAsync(
      { owner, value, invokedWhileOwned: owns(owner) },
      callbacks(options, value),
    );
    if (!mayContinue(owner)) throw new Error('The active account changed');
    return result;
  };
  return { ...mutation, variables: mutation.variables?.value, mutate, mutateAsync };
}
