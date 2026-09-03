import { HStack, Image, Link, Spacer, Text, VStack } from "@expo/ui/swift-ui";
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
  /** Epoch ms such that `dateStyle: 'timer'` shows current elapsed. */
  timerBaseEpochMs: number;
  isRunning: boolean;
  /** When paused, freeze the timer at this instant. */
  pauseTimeEpochMs: number;
  logSetUrl: string;
};

const ACCENT = "#FF6B35";
const TEAL = "#5EEAD4";

/**
 * Lock Screen / Dynamic Island card while a session is in progress.
 *
 * Layout helpers stay inside this function: the `'widget'` directive serializes
 * only the body into the widget extension's separate JS runtime.
 */
const WorkoutLiveActivity = (
  props: WorkoutLiveProps,
  environment: LiveActivityEnvironment
) => {
  "widget";
  const dim = environment.colorScheme === "dark" ? "#FFFFFF99" : "#FFFFFFAA";

  const Elapsed = ({ size, color, width }: { size: number; color: string; width: number }) => (
    <Text
      date={new Date(props.timerBaseEpochMs)}
      dateStyle="timer"
      pauseTime={
        props.isRunning ? undefined : new Date(props.pauseTimeEpochMs || Date.now())
      }
      modifiers={[
        font({ weight: "semibold", size }),
        monospacedDigit(),
        foregroundStyle(color),
        frame({ width, alignment: "trailing" }),
      ]}
    />
  );

  const title = props.exerciseName || "Workout";
  const setLine = [props.setLabel, props.prescription].filter(Boolean).join(" · ");

  return {
    banner: (
      <VStack
        alignment="leading"
        spacing={8}
        modifiers={[
          containerBackground("#161A22", "widget"),
          clipShape("containerRelativeShape"),
          padding({ all: 14 }),
          frame({ maxWidth: Infinity, alignment: "leading" }),
        ]}
      >
        <HStack spacing={8}>
          <Image systemName="dumbbell.fill" size={14} color={ACCENT} />
          <Text modifiers={[font({ weight: "medium", size: 13 }), foregroundStyle(dim)]}>
            {props.dayLabel || "GymAI"}
          </Text>
          <Spacer />
          <Elapsed size={13} color={TEAL} width={56} />
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
          <HStack spacing={10}>
            <Text modifiers={[font({ weight: "medium", size: 14 }), foregroundStyle(dim)]}>
              {setLine}
            </Text>
            <Spacer />
            <Link
              label="Log set"
              destination={props.logSetUrl || "gymai://workout/log-set"}
              modifiers={[font({ weight: "semibold", size: 13 }), foregroundStyle(ACCENT)]}
            />
          </HStack>
        ) : null}
      </VStack>
    ),
    compactLeading: <Image systemName="dumbbell.fill" size={14} color={ACCENT} />,
    compactTrailing: <Elapsed size={13} color="#FFFFFF" width={48} />,
    minimal: <Image systemName="dumbbell.fill" size={16} color={ACCENT} />,
    expandedLeading: (
      <HStack spacing={6} modifiers={[padding({ leading: 6 })]}>
        <Image systemName="dumbbell.fill" size={14} color={ACCENT} />
        <Text
          modifiers={[
            font({ weight: "semibold", size: 13 }),
            foregroundStyle("#FFFFFF"),
          ]}
        >
          GymAI
        </Text>
      </HStack>
    ),
    expandedTrailing: (
      <HStack modifiers={[padding({ trailing: 6 })]}>
        <Elapsed size={14} color={TEAL} width={52} />
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
        <Link
          label="Log prescribed set"
          destination={props.logSetUrl || "gymai://workout/log-set"}
          modifiers={[font({ weight: "semibold", size: 13 }), foregroundStyle(ACCENT)]}
        />
      </VStack>
    ),
  };
};

export default createLiveActivity<WorkoutLiveProps>("WorkoutLiveActivity", WorkoutLiveActivity);
