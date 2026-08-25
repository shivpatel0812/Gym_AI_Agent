/**
 * expo-notifications (via Expo prebuild) injects `aps-environment` whenever the
 * package is installed. That forces the Push Notifications capability onto the
 * Ad Hoc provisioning profile. We only schedule *local* sleep reminders, so Push
 * is unused — strip the entitlement so Ad Hoc builds don't fail when the Apple
 * App ID does not have Push enabled.
 */
const { withEntitlementsPlist } = require("@expo/config-plugins");

function withLocalNotificationsOnly(config) {
  return withEntitlementsPlist(config, (cfg) => {
    if (cfg.modResults && "aps-environment" in cfg.modResults) {
      delete cfg.modResults["aps-environment"];
    }
    return cfg;
  });
}

module.exports = withLocalNotificationsOnly;
