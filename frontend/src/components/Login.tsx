import { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  TouchableOpacity,
  Linking,
  Alert,
} from 'react-native';
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
} from 'firebase/auth';
import DateTimePicker from '@react-native-community/datetimepicker';
import { auth } from '../firebase';
import { legal, MINIMUM_AGE } from '../config';
import { friendlyAuthError } from '../lib/authErrors';
import { ONBOARDING_DISCLAIMER } from './legal/disclaimers';
import LinearGradient from './shared/LinearGradient';
import { MaterialCommunityIcons } from "@expo/vector-icons";
import Button from './shared/Button';
import Input from './shared/Input';
import Card from './shared/Card';
import { colors, spacing, borderRadius, shadows } from '../theme';

/** Whole years between `dob` and today. */
function ageFrom(dob: Date): number {
  const today = new Date();
  let age = today.getFullYear() - dob.getFullYear();
  const monthDelta = today.getMonth() - dob.getMonth();
  if (monthDelta < 0 || (monthDelta === 0 && today.getDate() < dob.getDate())) {
    age -= 1;
  }
  return age;
}

function formatDob(dob: Date): string {
  return dob.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSignUp, setIsSignUp] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Sign-up only
  const [dob, setDob] = useState<Date | null>(null);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [acceptedTerms, setAcceptedTerms] = useState(false);

  const resetMessages = () => {
    setError('');
    setNotice('');
  };

  const switchMode = () => {
    resetMessages();
    setIsSignUp((prev) => !prev);
    setAcceptedTerms(false);
  };

  const handleDobChange = (_event: any, selected?: Date) => {
    // Android's picker is a modal that closes itself; iOS keeps it inline.
    if (Platform.OS !== 'ios') setShowDatePicker(false);
    if (selected) {
      setDob(selected);
      resetMessages();
    }
  };

  const validateSignUp = (): string | null => {
    if (!dob) return 'Please enter your date of birth.';
    const age = ageFrom(dob);
    if (age < MINIMUM_AGE) {
      return `You must be at least ${MINIMUM_AGE} to use GymAI. GymAI creates calorie and training targets that aren't appropriate for younger users.`;
    }
    if (age > 120) return 'Please check your date of birth.';
    if (!acceptedTerms) return 'Please accept the Terms and Privacy Policy to continue.';
    return null;
  };

  const handleSubmit = async () => {
    resetMessages();
    if (!email.trim()) return setError('Please enter your email address.');
    if (!password) return setError('Please enter your password.');

    if (isSignUp) {
      const problem = validateSignUp();
      if (problem) return setError(problem);
    }

    setSubmitting(true);
    try {
      if (isSignUp) {
        await createUserWithEmailAndPassword(auth, email.trim(), password);
      } else {
        await signInWithEmailAndPassword(auth, email.trim(), password);
      }
    } catch (err: any) {
      setError(friendlyAuthError(err));
    } finally {
      setSubmitting(false);
    }
  };

  const handleForgotPassword = async () => {
    resetMessages();
    if (!email.trim()) {
      return setError('Enter your email address first, then tap Forgot password.');
    }
    setSubmitting(true);
    try {
      await sendPasswordResetEmail(auth, email.trim());
      // Deliberately the same message whether or not the account exists, so
      // this can't be used to discover which emails are registered.
      setNotice(
        "If an account exists for that email, a password reset link is on its way. Check your spam folder too."
      );
    } catch (err: any) {
      setError(friendlyAuthError(err));
    } finally {
      setSubmitting(false);
    }
  };

  const openLink = (url: string) => {
    Linking.openURL(url).catch(() =>
      Alert.alert('Could not open link', `Please visit ${url} in your browser.`)
    );
  };

  return (
    <LinearGradient
      colors={[colors.background, colors.cardBackground]}
      style={styles.container}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.keyboardView}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.logoContainer}>
            <LinearGradient
              colors={[colors.accentPrimary, colors.accentSecondary]}
              style={styles.logo}
            >
              <MaterialCommunityIcons name="dumbbell" size={48} color={colors.textPrimary} />
            </LinearGradient>
            <Text style={styles.appName}>GymAI</Text>
            <Text style={styles.tagline}>Your Fitness Companion</Text>
          </View>

          <Card style={styles.card}>
            <Text style={styles.title}>{isSignUp ? 'Create Account' : 'Welcome Back'}</Text>
            <Text style={styles.subtitle}>
              {isSignUp ? 'Start your fitness journey' : 'Sign in to continue'}
            </Text>

            <Input
              label="Email"
              value={email}
              onChangeText={(value) => {
                setEmail(value);
                resetMessages();
              }}
              keyboardType="email-address"
              autoCapitalize="none"
              autoComplete="email"
              textContentType="emailAddress"
              icon={<MaterialCommunityIcons name="email-outline" size={20} color={colors.textSecondary} />}
            />

            <Input
              label="Password"
              value={password}
              onChangeText={(value) => {
                setPassword(value);
                resetMessages();
              }}
              secureTextEntry
              autoCapitalize="none"
              textContentType={isSignUp ? 'newPassword' : 'password'}
              icon={<MaterialCommunityIcons name="lock-outline" size={20} color={colors.textSecondary} />}
            />

            {isSignUp && (
              <>
                <Text style={styles.fieldLabel}>Date of birth</Text>
                <TouchableOpacity
                  style={styles.dobField}
                  onPress={() => setShowDatePicker(true)}
                  activeOpacity={0.8}
                >
                  <MaterialCommunityIcons
                    name="cake-variant-outline"
                    size={20}
                    color={colors.textSecondary}
                  />
                  <Text style={[styles.dobText, !dob && styles.dobPlaceholder]}>
                    {dob ? formatDob(dob) : 'Select your date of birth'}
                  </Text>
                </TouchableOpacity>
                <Text style={styles.fieldHint}>
                  GymAI is for ages {MINIMUM_AGE} and up. We use this to keep guidance appropriate.
                </Text>

                {showDatePicker && (
                  <View style={styles.pickerWrap}>
                    <DateTimePicker
                      value={dob ?? new Date(2000, 0, 1)}
                      mode="date"
                      display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                      maximumDate={new Date()}
                      minimumDate={new Date(1920, 0, 1)}
                      onChange={handleDobChange}
                      themeVariant="dark"
                    />
                    {Platform.OS === 'ios' && (
                      <Button
                        title="Done"
                        variant="secondary"
                        onPress={() => setShowDatePicker(false)}
                      />
                    )}
                  </View>
                )}

                <TouchableOpacity
                  style={styles.consentRow}
                  onPress={() => {
                    setAcceptedTerms((prev) => !prev);
                    resetMessages();
                  }}
                  activeOpacity={0.8}
                >
                  <MaterialCommunityIcons
                    name={acceptedTerms ? 'checkbox-marked' : 'checkbox-blank-outline'}
                    size={22}
                    color={acceptedTerms ? colors.accentPrimary : colors.textSecondary}
                  />
                  <Text style={styles.consentText}>
                    I agree to the{' '}
                    <Text style={styles.link} onPress={() => openLink(legal.termsUrl)}>
                      Terms of Use
                    </Text>{' '}
                    and{' '}
                    <Text style={styles.link} onPress={() => openLink(legal.privacyPolicyUrl)}>
                      Privacy Policy
                    </Text>
                    .
                  </Text>
                </TouchableOpacity>

                <View style={styles.disclaimerBox}>
                  <MaterialCommunityIcons
                    name="information-outline"
                    size={16}
                    color={colors.textSecondary}
                  />
                  <Text style={styles.disclaimerText}>{ONBOARDING_DISCLAIMER}</Text>
                </View>
              </>
            )}

            {!!error && (
              <View style={styles.errorBox}>
                <MaterialCommunityIcons name="alert-circle-outline" size={16} color={colors.danger} />
                <Text style={styles.errorText}>{error}</Text>
              </View>
            )}

            {!!notice && (
              <View style={styles.noticeBox}>
                <MaterialCommunityIcons name="email-check-outline" size={16} color={colors.success} />
                <Text style={styles.noticeText}>{notice}</Text>
              </View>
            )}

            <Button
              title={isSignUp ? 'Sign Up' : 'Sign In'}
              onPress={handleSubmit}
              variant="primary"
              loading={submitting}
              style={styles.button}
            />

            {!isSignUp && (
              <TouchableOpacity onPress={handleForgotPassword} disabled={submitting}>
                <Text style={styles.forgotText}>Forgot password?</Text>
              </TouchableOpacity>
            )}

            <View style={styles.switchContainer}>
              <Text style={styles.switchText}>
                {isSignUp ? 'Already have an account? ' : "Don't have an account? "}
              </Text>
              <Text style={styles.switchLink} onPress={switchMode}>
                {isSignUp ? 'Sign In' : 'Sign Up'}
              </Text>
            </View>
          </Card>

          {!isSignUp && (
            <View style={styles.footerLinks}>
              <Text style={styles.footerLink} onPress={() => openLink(legal.privacyPolicyUrl)}>
                Privacy Policy
              </Text>
              <Text style={styles.footerDot}>·</Text>
              <Text style={styles.footerLink} onPress={() => openLink(legal.termsUrl)}>
                Terms of Use
              </Text>
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  keyboardView: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: spacing.lg,
  },
  logoContainer: {
    alignItems: 'center',
    marginBottom: spacing['3xl'],
  },
  logo: {
    width: 96,
    height: 96,
    borderRadius: borderRadius.xl,
    justifyContent: 'center',
    alignItems: 'center',
    ...shadows.large,
    marginBottom: spacing.lg,
  },
  appName: {
    fontSize: 32,
    fontWeight: '700',
    color: colors.textPrimary,
    marginBottom: spacing.xs,
  },
  tagline: {
    fontSize: 16,
    color: colors.textSecondary,
  },
  card: {
    ...shadows.xl,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: colors.textPrimary,
    marginBottom: spacing.xs,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: spacing.xl,
  },
  fieldLabel: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: '600',
    marginBottom: spacing.sm,
  },
  dobField: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.cardBackground,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  dobText: {
    color: colors.textPrimary,
    fontSize: 16,
  },
  dobPlaceholder: {
    color: colors.textSecondary,
  },
  fieldHint: {
    color: colors.textSecondary,
    fontSize: 12,
    marginTop: spacing.xs,
    marginBottom: spacing.md,
  },
  pickerWrap: {
    marginBottom: spacing.md,
  },
  consentRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  consentText: {
    flex: 1,
    color: colors.textSecondary,
    fontSize: 13,
    lineHeight: 19,
  },
  link: {
    color: colors.accentPrimary,
    fontWeight: '600',
  },
  disclaimerBox: {
    flexDirection: 'row',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  disclaimerText: {
    flex: 1,
    color: colors.textSecondary,
    fontSize: 12,
    lineHeight: 17,
  },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    backgroundColor: 'rgba(239, 68, 68, 0.12)',
    borderRadius: borderRadius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  errorText: {
    flex: 1,
    color: colors.danger,
    fontSize: 13,
    lineHeight: 18,
  },
  noticeBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    backgroundColor: 'rgba(74, 222, 128, 0.12)',
    borderRadius: borderRadius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  noticeText: {
    flex: 1,
    color: colors.success,
    fontSize: 13,
    lineHeight: 18,
  },
  button: {
    marginTop: spacing.md,
  },
  forgotText: {
    color: colors.textSecondary,
    fontSize: 13,
    textAlign: 'center',
    marginTop: spacing.md,
  },
  switchContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: spacing.lg,
  },
  switchText: {
    color: colors.textSecondary,
    fontSize: 14,
  },
  switchLink: {
    color: colors.accentPrimary,
    fontSize: 14,
    fontWeight: '600',
  },
  footerLinks: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.xl,
  },
  footerLink: {
    color: colors.textSecondary,
    fontSize: 12,
    textDecorationLine: 'underline',
  },
  footerDot: {
    color: colors.textMuted,
    fontSize: 12,
  },
});
