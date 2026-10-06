import React from "react";
import { View } from "react-native";
import { useOxy } from "@oxy.so/services";
import { useQuery } from "@tanstack/react-query";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { useTranslation } from "@/hooks/useTranslation";
import { displayStorageUsage, readScopedStorage, type SharedStorageUsage } from "@/lib/shared-storage";

export function SharedStorageSection() {
  const { user, activeSessionId, isAuthenticated, oxyServices } = useOxy();
  const { t } = useTranslation();
  const identity = { accountId: user?.id ?? null, sessionId: activeSessionId ?? null };
  const current = React.useRef(identity);
  current.current = identity;
  const usage = useQuery({
    queryKey: ["noted-shared-storage", identity.accountId, identity.sessionId],
    enabled: isAuthenticated && !!identity.accountId && !!identity.sessionId,
    gcTime: 0,
    staleTime: 0,
    refetchOnWindowFocus: true,
    refetchInterval: 30_000,
    retry: false,
    queryFn: async () => {
      const value: SharedStorageUsage = await readScopedStorage(identity, () => current.current, () => oxyServices.assets.usage());
      return displayStorageUsage(value);
    },
  });
  return <View className="gap-2">
    <Text className="text-base font-semibold">{t("sharedStorage.title")}</Text>
    <Text className="text-sm text-muted-foreground">{t("sharedStorage.description")}</Text>
    {!isAuthenticated ? <Text>{t("sharedStorage.signIn")}</Text> : usage.isPending ? <Text>{t("sharedStorage.loading")}</Text> : usage.isError ? <Text>{t("sharedStorage.error")}</Text> : usage.data ? <>
      <Text>{t("sharedStorage.usage", { used: usage.data.usedGB, limit: usage.data.limitGB })}</Text>
      {usage.data.configured && (usage.data.availableGB === null ? <Text className="text-sm text-muted-foreground">{t("sharedStorage.reservationsUnknown")}</Text> : <>
        <Text>{t("sharedStorage.quotaUsage", { reserved: usage.data.reservedGB, available: usage.data.availableGB })}</Text>
        {usage.data.hasHolds && <Text className="text-sm text-muted-foreground">{t("sharedStorage.holds", { held: usage.data.heldGB })}</Text>}
      </>)}
      <Text className="text-sm text-muted-foreground">{t(usage.data.configured ? "sharedStorage.admission" : "sharedStorage.unconfigured")}</Text>
    </> : null}
    {isAuthenticated && <Button variant="outline" onPress={() => { void usage.refetch(); }}><Text>{t("sharedStorage.refresh")}</Text></Button>}
  </View>;
}
