import { readFileSync } from 'node:fs';

const gradle = readFileSync('packages/frontend/android/app/build.gradle', 'utf8');
const manifest = readFileSync('packages/frontend/android/app/src/main/AndroidManifest.xml', 'utf8');
const marker = '@generated oxy-release-signing: the Oxy ecosystem release key';
const checks = [
  [gradle.split(marker).length === 2, 'exactly one shared signing configuration'],
  [/signingConfig\s+signingConfigs\.release/.test(gradle), 'release uses shared signing'],
  [gradle.includes('oxyVerifyReleaseSigning'), 'release signing verification'],
  [gradle.includes('proguard-android-optimize.txt'), 'optimized Android release rules'],
  ...['IDENTITY', 'DEVICE_SESSION'].flatMap((name) => {
    const permission = `so.oxy.permission.${name}`;
    return [
      [
        manifest.includes(`<uses-permission android:name="${permission}"`),
        `${name} permission request`,
      ],
      [
        manifest.includes(
          `<permission android:name="${permission}" android:protectionLevel="signature"`,
        ),
        `${name} signature permission`,
      ],
    ];
  }),
];
for (const [passed, name] of checks) {
  if (!passed) throw new Error(`Android prebuild is missing ${name}`);
}
console.log('Android prebuild includes the shared Oxy signing and permissions.');
