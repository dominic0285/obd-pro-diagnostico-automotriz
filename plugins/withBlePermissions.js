/**
 * Custom Expo config plugin for react-native-ble-plx 3.x on Expo SDK 57+
 * Adds all required Bluetooth permissions to AndroidManifest.xml
 */
const { withAndroidManifest } = require('@expo/config-plugins');

const withBlePermissions = (config) => {
  return withAndroidManifest(config, (config) => {
    const manifest = config.modResults.manifest;

    // Ensure uses-permission array exists
    if (!manifest['uses-permission']) {
      manifest['uses-permission'] = [];
    }

    const permissions = [
      'android.permission.BLUETOOTH',
      'android.permission.BLUETOOTH_ADMIN',
      'android.permission.BLUETOOTH_SCAN',
      'android.permission.BLUETOOTH_CONNECT',
      'android.permission.BLUETOOTH_ADVERTISE',
      'android.permission.ACCESS_FINE_LOCATION',
      'android.permission.ACCESS_COARSE_LOCATION',
    ];

    const existing = manifest['uses-permission'].map(
      (p) => p.$?.['android:name']
    );

    for (const perm of permissions) {
      if (!existing.includes(perm)) {
        manifest['uses-permission'].push({
          $: { 'android:name': perm },
        });
      }
    }

    return config;
  });
};

module.exports = withBlePermissions;
