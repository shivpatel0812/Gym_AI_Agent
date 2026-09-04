/**
 * Full-screen food scan camera — Cal AI–style overlay on a live preview.
 * Scan Food is the working mode; Barcode / Food Label are shown but not live yet.
 */

import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { CameraView, useCameraPermissions } from "expo-camera";
import type { FlashMode } from "expo-camera";
import * as ImagePicker from "expo-image-picker";
import { useSafeAreaInsets } from "react-native-safe-area-context";

export type ScanCapture = {
  uri: string;
  fileName: string;
  mimeType: string;
};

type ScanMode = "food" | "barcode" | "label";

type Props = {
  visible: boolean;
  busy?: boolean;
  busyLabel?: string;
  onClose: () => void;
  onCapture: (capture: ScanCapture) => void;
};

function Corner({
  top,
  left,
  right,
  bottom,
}: {
  top?: boolean;
  left?: boolean;
  right?: boolean;
  bottom?: boolean;
}) {
  return (
    <View
      style={[
        styles.corner,
        top && { top: 0 },
        bottom && { bottom: 0 },
        left && { left: 0 },
        right && { right: 0 },
        top && left && { borderTopWidth: 3, borderLeftWidth: 3, borderTopLeftRadius: 4 },
        top && right && { borderTopWidth: 3, borderRightWidth: 3, borderTopRightRadius: 4 },
        bottom && left && { borderBottomWidth: 3, borderLeftWidth: 3, borderBottomLeftRadius: 4 },
        bottom &&
          right && { borderBottomWidth: 3, borderRightWidth: 3, borderBottomRightRadius: 4 },
      ]}
    />
  );
}

export default function ScanFoodCamera({
  visible,
  busy = false,
  busyLabel = "Estimating…",
  onClose,
  onCapture,
}: Props) {
  const insets = useSafeAreaInsets();
  const cameraRef = useRef<CameraView>(null);
  const [permission, requestPermission] = useCameraPermissions();
  const [flash, setFlash] = useState<FlashMode>("off");
  const [mode, setMode] = useState<ScanMode>("food");
  const [capturing, setCapturing] = useState(false);
  const [modeHint, setModeHint] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // `permission` changes when a request resolves, so keeping it in the effect's
  // deps re-runs the effect and re-prompts. On Android `canAskAgain` stays true
  // after a plain Deny, which turns that into a prompt the user cannot escape.
  const askedRef = useRef(false);

  useEffect(() => {
    if (!visible) {
      setMode("food");
      setModeHint(null);
      setCapturing(false);
      setError(null);
      askedRef.current = false;
      return;
    }
    if (askedRef.current) return;
    if (permission && !permission.granted && permission.canAskAgain) {
      askedRef.current = true;
      void requestPermission();
    }
  }, [visible, permission, requestPermission]);

  const emitCapture = (uri: string, fileName?: string | null, mimeType?: string | null) => {
    onCapture({
      uri,
      fileName: fileName || "meal.jpg",
      mimeType: mimeType || "image/jpeg",
    });
  };

  const takePicture = async () => {
    if (busy || capturing || mode !== "food") return;
    setCapturing(true);
    setError(null);
    try {
      if (cameraRef.current) {
        try {
          const photo = await cameraRef.current.takePictureAsync({
            quality: 0.85,
            skipProcessing: Platform.OS === "android",
          });
          if (photo?.uri) {
            emitCapture(photo.uri);
            return;
          }
        } catch {
          // The live view exists but the shutter failed. Fall through to the
          // picker rather than leaving the user tapping a dead button.
        }
      }
      // Fallback when the live camera view isn't available (simulator / web)
      // or the capture above did not produce a frame.
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) {
        setError("Camera permission is needed to take a photo.");
        return;
      }
      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.9,
      });
      if (result.canceled) return;
      const asset = result.assets?.[0];
      if (!asset?.uri) {
        setError("That photo didn't come through. Try again.");
        return;
      }
      emitCapture(asset.uri, asset.fileName, asset.mimeType);
    } catch {
      // "The user can retry" only works if they know it failed.
      setError("Couldn't take that photo. Try again, or pick one from your library.");
    } finally {
      setCapturing(false);
    }
  };

  const openLibrary = async () => {
    if (busy || capturing) return;
    setError(null);
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        setError("Photo library permission is needed.");
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.9,
      });
      if (result.canceled) return;
      const asset = result.assets?.[0];
      if (!asset?.uri) {
        setError("That photo didn't come through. Try another one.");
        return;
      }
      emitCapture(asset.uri, asset.fileName, asset.mimeType);
    } catch {
      setError("Couldn't open your photo library.");
    }
  };

  const selectMode = (next: ScanMode) => {
    setMode(next);
    setError(null);
    if (next === "food") {
      setModeHint(null);
      return;
    }
    setModeHint(
      next === "barcode"
        ? "Barcode scan is coming soon — use Scan Food for now."
        : "Food label scan is coming soon — use Scan Food for now."
    );
  };

  const granted = permission?.granted;

  return (
    <Modal
      visible={visible}
      animationType="fade"
      presentationStyle="fullScreen"
      onRequestClose={onClose}
    >
      <View style={styles.root}>
        {granted ? (
          <CameraView
            ref={cameraRef}
            style={StyleSheet.absoluteFill}
            facing="back"
            flash={flash}
            mode="picture"
          />
        ) : (
          <View style={[StyleSheet.absoluteFill, styles.permissionFallback]}>
            <MaterialCommunityIcons name="camera-off-outline" size={40} color="#FFFFFF" />
            <Text style={styles.permissionTitle}>Camera access needed</Text>
            <Text style={styles.permissionBody}>
              Allow camera access to scan meals, or pick a photo from your library.
            </Text>
            <TouchableOpacity style={styles.permissionBtn} onPress={() => void requestPermission()}>
              <Text style={styles.permissionBtnText}>Allow camera</Text>
            </TouchableOpacity>
          </View>
        )}

        <View style={[styles.topBar, { paddingTop: Math.max(insets.top, 12) + 4 }]}>
          <TouchableOpacity
            style={styles.circleBtn}
            onPress={onClose}
            hitSlop={8}
            accessibilityLabel="Close scanner"
          >
            <MaterialCommunityIcons name="close" size={20} color="#FFFFFF" />
          </TouchableOpacity>
          <View style={styles.brandRow}>
            <MaterialCommunityIcons name="fire" size={16} color="#FF8A5B" />
            <Text style={styles.brand}>GymAI</Text>
          </View>
          <TouchableOpacity
            style={styles.circleBtn}
            onPress={() => void openLibrary()}
            accessibilityLabel="Choose from library"
          >
            <MaterialCommunityIcons name="image-outline" size={18} color="#FFFFFF" />
          </TouchableOpacity>
        </View>

        <View style={styles.frameWrap} pointerEvents="none">
          <View style={styles.frame}>
            <Corner top left />
            <Corner top right />
            <Corner bottom left />
            <Corner bottom right />
          </View>
        </View>

        <View style={[styles.bottom, { paddingBottom: Math.max(insets.bottom, 16) + 8 }]}>
          {error ? <Text style={styles.errorText}>{error}</Text> : null}
          {modeHint ? <Text style={styles.modeHint}>{modeHint}</Text> : null}

          <View style={styles.modeRow}>
            {(
              [
                { id: "food" as const, label: "Scan Food", icon: "food-apple-outline" as const },
                { id: "barcode" as const, label: "Barcode", icon: "barcode" as const },
                { id: "label" as const, label: "Food Label", icon: "tag-text-outline" as const },
              ] as const
            ).map((item) => {
              const active = mode === item.id;
              return (
                <TouchableOpacity
                  key={item.id}
                  style={[styles.modeChip, active && styles.modeChipOn]}
                  onPress={() => selectMode(item.id)}
                >
                  <MaterialCommunityIcons
                    name={item.icon}
                    size={18}
                    color={active ? "#111111" : "#FFFFFF"}
                  />
                  <Text style={[styles.modeChipText, active && styles.modeChipTextOn]}>
                    {item.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <View style={styles.shutterRow}>
            <TouchableOpacity
              style={styles.circleBtn}
              onPress={() => setFlash((f) => (f === "off" ? "on" : "off"))}
              accessibilityLabel={flash === "on" ? "Turn flash off" : "Turn flash on"}
            >
              <MaterialCommunityIcons
                name={flash === "on" ? "flash" : "flash-off"}
                size={20}
                color="#FFFFFF"
              />
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.shutter,
                (busy || capturing || mode !== "food") && styles.shutterDisabled,
              ]}
              onPress={() => void takePicture()}
              disabled={busy || capturing || mode !== "food"}
              accessibilityLabel="Take photo"
            >
              <View style={styles.shutterInner} />
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.circleBtn}
              onPress={() => void openLibrary()}
              accessibilityLabel="Photo library"
            >
              <MaterialCommunityIcons name="image-multiple-outline" size={18} color="#FFFFFF" />
            </TouchableOpacity>
          </View>
        </View>

        {(busy || capturing) && (
          <View style={styles.busyOverlay}>
            <ActivityIndicator size="large" color="#FFFFFF" />
            <Text style={styles.busyText}>{capturing ? "Capturing…" : busyLabel}</Text>
          </View>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#000",
  },
  permissionFallback: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#111113",
    paddingHorizontal: 32,
    gap: 10,
  },
  permissionTitle: {
    color: "#FFFFFF",
    fontSize: 18,
    fontWeight: "700",
    marginTop: 8,
  },
  permissionBody: {
    color: "rgba(255,255,255,0.65)",
    fontSize: 14,
    textAlign: "center",
    lineHeight: 20,
  },
  permissionBtn: {
    marginTop: 10,
    backgroundColor: "#FFFFFF",
    borderRadius: 999,
    paddingHorizontal: 18,
    paddingVertical: 10,
  },
  permissionBtnText: {
    color: "#111111",
    fontWeight: "700",
    fontSize: 14,
  },
  topBar: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    zIndex: 2,
  },
  brandRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  brand: {
    color: "#FFFFFF",
    fontSize: 17,
    fontWeight: "700",
    letterSpacing: 0.2,
  },
  circleBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(0,0,0,0.35)",
    alignItems: "center",
    justifyContent: "center",
  },
  frameWrap: {
    ...StyleSheet.absoluteFill,
    alignItems: "center",
    justifyContent: "center",
    paddingBottom: 40,
  },
  frame: {
    width: "72%",
    aspectRatio: 1,
    maxWidth: 320,
  },
  corner: {
    position: "absolute",
    width: 34,
    height: 34,
    borderColor: "#FFFFFF",
  },
  bottom: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 16,
    gap: 16,
    zIndex: 2,
  },
  errorText: {
    textAlign: "center",
    color: "#FFB4A2",
    fontSize: 13,
    fontWeight: "600",
    marginBottom: -4,
  },
  modeHint: {
    textAlign: "center",
    color: "rgba(255,255,255,0.85)",
    fontSize: 12,
    marginBottom: -4,
  },
  modeRow: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 10,
  },
  modeChip: {
    minWidth: 92,
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderRadius: 14,
    backgroundColor: "rgba(0,0,0,0.38)",
  },
  modeChipOn: {
    backgroundColor: "#FFFFFF",
  },
  modeChipText: {
    color: "#FFFFFF",
    fontSize: 11,
    fontWeight: "600",
  },
  modeChipTextOn: {
    color: "#111111",
  },
  shutterRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 18,
  },
  shutter: {
    width: 78,
    height: 78,
    borderRadius: 39,
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
  },
  shutterDisabled: {
    opacity: 0.45,
  },
  shutterInner: {
    width: 64,
    height: 64,
    borderRadius: 32,
    borderWidth: 3,
    borderColor: "#111111",
    backgroundColor: "#FFFFFF",
  },
  busyOverlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: "rgba(0,0,0,0.55)",
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    zIndex: 5,
  },
  busyText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "600",
  },
});
