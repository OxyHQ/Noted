import { View } from "react-native";
import { LabelChip } from "./label-color";
import { Chip } from "@oxy.so/bloom/chip";
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
        <LabelChip key={label.id} label={label} />
      ))}
      {overflow > 0 && (
        <Chip size="sm" appearance="subtle" tone="neutral">
          +{overflow}
        </Chip>
      )}
    </View>
  );
}
