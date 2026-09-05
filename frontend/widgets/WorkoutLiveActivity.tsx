import { HStack, Image, Spacer, Text, VStack } from "@expo/ui/swift-ui";
import {
  clipShape,
  containerBackground,
  font,
  foregroundStyle,
  frame,
  monospacedDigit,
  padding,
} from "@expo/ui/swift-ui/modifiers";
import { createLiveActivity, type LiveActivityEnvironment } from "expo-widgets";

export type WorkoutLiveProps = {
  dayLabel: string;
  exerciseName: string;
  setLabel: string;
  prescription: string;
  /** Preformatted mm:ss / h:mm:ss — prefer plain text over timer Text APIs. */
  elapsedLabel: string;
  isRunning: boolean;
};

const ACCENT = "#FF6B35";
const TEAL = "#5EEAD4";
const BG = "#161A22";

/**
 * Lock Screen / Dynamic Island card while a session is in progress.
 *
 * Keep this layout simple: blank Live Activity shells are a known
 * expo-widgets failure mode when the widget JS tree is heavy or uses
 * APIs the extension runtime fails to evaluate (native timer Text,
 * Links, etc.). Plain Text + Image is the reliable path.
 */
const WorkoutLiveActivity = (
  props: WorkoutLiveProps,
  environment: LiveActivityEnvironment
) => {
  "widget";
  const dim = environment.colorScheme === "dark" ? "#FFFFFF99" : "#FFFFFFAA";
  const title = props.exerciseName || "Workout";
  const day = props.dayLabel || "GymAI";
  const setLine = [props.setLabel, props.prescription].filter(Boolean).join(" · ");
  const elapsed = props.elapsedLabel || "00:00";

  return {
    banner: (
      <VStack
        alignment="leading"
        spacing={6}
        modifiers={[
          containerBackground(BG, "widget"),
          clipShape("containerRelativeShape"),
          padding({ all: 14 }),
          frame({ maxWidth: Infinity, alignment: "leading" }),
        ]}
      >
        <HStack spacing={8}>
          <Image systemName="dumbbell.fill" size={14} color={ACCENT} />
          <Text modifiers={[font({ weight: "medium", size: 13 }), foregroundStyle(dim)]}>
            {day}
          </Text>
          <Spacer />
          <Text
            modifiers={[
              font({ weight: "semibold", size: 13 }),
              monospacedDigit(),
              foregroundStyle(TEAL),
            ]}
          >
            {elapsed}
          </Text>
        </HStack>
        <Text
          modifiers={[
            font({ weight: "bold", size: 18 }),
            foregroundStyle("#FFFFFF"),
            frame({ maxWidth: Infinity, alignment: "leading" }),
          ]}
        >
          {title}
        </Text>
        {setLine ? (
          <Text modifiers={[font({ weight: "medium", size: 14 }), foregroundStyle(dim)]}>
            {setLine}
          </Text>
        ) : null}
      </VStack>
    ),
    compactLeading: <Image systemName="dumbbell.fill" size={14} color={ACCENT} />,
    compactTrailing: (
      <Text
        modifiers={[
          font({ weight: "semibold", size: 13 }),
          monospacedDigit(),
          foregroundStyle("#FFFFFF"),
        ]}
      >
        {elapsed}
      </Text>
    ),
    minimal: <Image systemName="dumbbell.fill" size={16} color={ACCENT} />,
    expandedLeading: (
      <HStack spacing={6} modifiers={[padding({ leading: 6 })]}>
        <Image systemName="dumbbell.fill" size={14} color={ACCENT} />
        <Text modifiers={[font({ weight: "semibold", size: 13 }), foregroundStyle("#FFFFFF")]}>
          GymAI
        </Text>
      </HStack>
    ),
    expandedTrailing: (
      <HStack modifiers={[padding({ trailing: 6 })]}>
        <Text
          modifiers={[
            font({ weight: "semibold", size: 14 }),
            monospacedDigit(),
            foregroundStyle(TEAL),
          ]}
        >
          {elapsed}
        </Text>
      </HStack>
    ),
    expandedBottom: (
      <VStack
        alignment="leading"
        spacing={4}
        modifiers={[padding({ top: 4, horizontal: 6 }), frame({ maxWidth: Infinity })]}
      >
        <Text modifiers={[font({ weight: "bold", size: 15 }), foregroundStyle("#FFFFFF")]}>
          {title}
        </Text>
        {setLine ? (
          <Text modifiers={[font({ size: 13 }), foregroundStyle(dim)]}>{setLine}</Text>
        ) : null}
      </VStack>
    ),
  };
};

export default createLiveActivity<WorkoutLiveProps>("WorkoutLiveActivity", WorkoutLiveActivity);
