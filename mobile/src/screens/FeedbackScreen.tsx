import React, { useState } from "react";
import {
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import * as ImagePicker from "expo-image-picker";
import * as MailComposer from "expo-mail-composer";
import { ImagePlus, X } from "lucide-react-native";
import {
  BackLink,
  BrutalButton,
  DisplayTitle,
  MetaTag,
} from "../components/ui";
import { FadeFromBlank } from "../components/LoadingSkeletons";
import { AppIcon } from "../icons";
import { colors, font, radius, result, spacing, type } from "../theme";

const FEEDBACK_EMAIL = "equalrightsdev@gmail.com";
const MAX_IMAGES = 5;

type Props = {
  onBack: () => void;
};

type FeedbackKind = "bug" | "idea";

export function FeedbackScreen({ onBack }: Props) {
  const [kind, setKind] = useState<FeedbackKind>("bug");
  const [message, setMessage] = useState("");
  const [images, setImages] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  const subject = kind === "bug" ? "Bug report" : "Feature idea";
  const placeholder =
    kind === "bug" ? "Describe the bug…" : "Describe the feature…";

  const onPickImages = async () => {
    setStatus(null);
    setFailed(false);
    const remaining = MAX_IMAGES - images.length;
    if (remaining <= 0) {
      setFailed(true);
      setStatus(`You can attach up to ${MAX_IMAGES} images.`);
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsMultipleSelection: true,
      selectionLimit: remaining,
      quality: 0.85,
    });
    if (result.canceled || !result.assets?.length) return;
    const uris = result.assets
      .map((asset) => asset.uri)
      .filter((uri): uri is string => Boolean(uri));
    setImages((prev) => [...prev, ...uris].slice(0, MAX_IMAGES));
  };

  const onRemoveImage = (uri: string) => {
    setImages((prev) => prev.filter((item) => item !== uri));
  };

  const onSubmit = async () => {
    if (busy) return;
    const body = message.trim();
    if (!body) {
      setFailed(true);
      setStatus("Write a message before submitting.");
      return;
    }
    setBusy(true);
    setFailed(false);
    setStatus(null);
    try {
      const available = await MailComposer.isAvailableAsync();
      if (!available) {
        setFailed(true);
        setStatus("No mail app available on this device.");
        return;
      }
      const result = await MailComposer.composeAsync({
        recipients: [FEEDBACK_EMAIL],
        subject,
        body,
        attachments: images,
      });
      if (result.status === MailComposer.MailComposerStatus.SENT) {
        setMessage("");
        setImages([]);
        setStatus("Feedback sent. Thanks.");
      }
    } catch (e) {
      setFailed(true);
      setStatus(e instanceof Error ? e.message : "Could not open mail.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <FadeFromBlank contentKey={`feedback:${kind}`} ready style={styles.fade}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <BackLink label="Profile" onPress={onBack} style={styles.back} />
        <DisplayTitle size={30}>Feedback</DisplayTitle>

        <BrutalButton
          label={busy ? "Opening mail…" : "Submit"}
          onPress={() => void onSubmit()}
          disabled={busy}
          style={styles.submit}
        />

        <View style={styles.toggleRow}>
          <MetaTag
            label="Bug report"
            active={kind === "bug"}
            onPress={() => {
              setKind("bug");
              setStatus(null);
              setFailed(false);
            }}
          />
          <MetaTag
            label="Feature idea"
            active={kind === "idea"}
            onPress={() => {
              setKind("idea");
              setStatus(null);
              setFailed(false);
            }}
          />
        </View>

        <TextInput
          value={message}
          onChangeText={(value) => {
            setMessage(value);
            setStatus(null);
            setFailed(false);
          }}
          placeholder={placeholder}
          placeholderTextColor={colors.textDim}
          autoCapitalize="sentences"
          multiline
          textAlignVertical="top"
          style={[styles.input, styles.textarea]}
        />

        <Pressable
          onPress={() => void onPickImages()}
          style={({ pressed }) => [
            styles.imageButton,
            pressed && styles.pressed,
          ]}
          accessibilityRole="button"
          accessibilityLabel="Add images"
        >
          <AppIcon icon={ImagePlus} size={20} color={colors.textSoft} />
          <Text style={styles.imageButtonLabel}>
            {images.length
              ? `Add images (${images.length}/${MAX_IMAGES})`
              : "Add images"}
          </Text>
        </Pressable>

        {images.length ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.thumbs}
          >
            {images.map((uri) => (
              <View key={uri} style={styles.thumbWrap}>
                <Image source={{ uri }} style={styles.thumb} />
                <Pressable
                  onPress={() => onRemoveImage(uri)}
                  style={styles.thumbRemove}
                  hitSlop={8}
                  accessibilityLabel="Remove image"
                >
                  <AppIcon icon={X} size={14} color={colors.text} />
                </Pressable>
              </View>
            ))}
          </ScrollView>
        ) : null}

        {status ? (
          <Text
            style={[
              styles.status,
              { color: failed ? result.loss : colors.sage },
            ]}
          >
            {status}
          </Text>
        ) : null}
      </ScrollView>
    </FadeFromBlank>
  );
}

const styles = StyleSheet.create({
  fade: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  scroll: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  content: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.lg,
    paddingBottom: 120,
  },
  back: {
    marginBottom: spacing.sm,
  },
  submit: {
    marginTop: spacing.lg,
  },
  toggleRow: {
    flexDirection: "row",
    gap: spacing.sm,
    flexWrap: "wrap",
    marginTop: spacing.xl,
  },
  input: {
    borderRadius: radius.md,
    backgroundColor: colors.muted,
    color: colors.text,
    fontFamily: font.sans,
    fontSize: 15,
    paddingHorizontal: spacing.md,
    paddingVertical: 13,
  },
  textarea: {
    minHeight: 160,
    marginTop: spacing.md,
    paddingTop: 13,
  },
  imageButton: {
    marginTop: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: 12,
  },
  imageButtonLabel: {
    ...type.body,
    color: colors.textSoft,
  },
  thumbs: {
    gap: spacing.sm,
    paddingVertical: spacing.sm,
  },
  thumbWrap: {
    width: 72,
    height: 72,
    borderRadius: radius.sm,
    overflow: "hidden",
    backgroundColor: colors.muted,
  },
  thumb: {
    width: 72,
    height: 72,
  },
  thumbRemove: {
    position: "absolute",
    top: 4,
    right: 4,
    width: 22,
    height: 22,
    borderRadius: radius.pill,
    backgroundColor: "rgba(0,0,0,0.65)",
    alignItems: "center",
    justifyContent: "center",
  },
  pressed: {
    opacity: 0.55,
  },
  status: {
    ...type.caption,
    marginTop: spacing.sm,
  },
});
