import { View } from "react-native";
import { Tag } from "lucide-react-native";
import { Text } from "@/components/ui/text";
import type { Label } from "@noted/shared-types";

interface LabelChipsProps {
  /** Label ids assigned to the note. */
  labelIds: string[];
  /** All labels, used to resolve ids to names. */
  allLabels: Label[];
  /** Cap the number of chips rendered (card previews). */
  max?: number;
}

/** Small inline label chips, used on note cards and the editor. */
export function LabelChips({ labelIds, allLabels, max }: LabelChipsProps) {
  if (labelIds.length === 0) return null;

  const byId = new Map(allLabels.map((l) => [l.id, l]));
  const resolved = labelIds
    .map((id) => byId.get(id))
    .filter((l): l is Label => Boolean(l));

  if (resolved.length === 0) return null;

  const shown = typeof max === "number" ? resolved.slice(0, max) : resolved;
  const overflow = resolved.length - shown.length;

  return (
    <View className="mt-1.5 flex-row flex-wrap gap-1">
      {shown.map((label) => (
        <View
          key={label.id}
          className="flex-row items-center gap-1 rounded-full bg-foreground/10 px-2 py-0.5"
        >
          <Tag size={10} className="text-muted-foreground" />
          <Text className="text-[11px] text-muted-foreground" numberOfLines={1}>
            {label.name}
          </Text>
        </View>
      ))}
      {overflow > 0 && (
        <View className="rounded-full bg-foreground/10 px-2 py-0.5">
          <Text className="text-[11px] text-muted-foreground">+{overflow}</Text>
        </View>
      )}
    </View>
  );
}
