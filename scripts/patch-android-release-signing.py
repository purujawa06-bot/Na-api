#!/usr/bin/env python3
import pathlib
import re
import sys

def patch():
    patched_any = False
    for p in [pathlib.Path('android/app/build.gradle'), pathlib.Path('android/app/build.gradle.kts')]:
        if not p.exists():
            continue
        s = p.read_text(encoding='utf-8')
        if 'key.properties' in s and 'signingConfigs' in s and 'release' in s:
            print(f'signing already configured in {p}')
            continue
        if p.suffix == '.kts':
            pre = (
                'import java.util.Properties\n'
                'import java.io.FileInputStream\n\n'
                'val keystoreProperties = Properties()\n'
                'val keystorePropertiesFile = rootProject.file("key.properties")\n'
                'if (keystorePropertiesFile.exists()) {\n'
                '    keystoreProperties.load(FileInputStream(keystorePropertiesFile))\n'
                '}\n\n'
            )
            sc = (
                '\n    signingConfigs {\n'
                '        create("release") {\n'
                '            keyAlias = keystoreProperties["keyAlias"] as String?\n'
                '            keyPassword = keystoreProperties["keyPassword"] as String?\n'
                '            storeFile = keystoreProperties["storeFile"]?.let { file(it as String) }\n'
                '            storePassword = keystoreProperties["storePassword"] as String?\n'
                '            storeType = (keystoreProperties["storeType"] as String?) ?: "PKCS12"\n'
                '        }\n'
                '    }\n'
            )
            if 'import java.util.Properties' not in s:
                s = pre + s
            m = re.search(r'\nandroid\s*\{', s)
            if m:
                s = s[:m.end()] + sc + s[m.end():]
            # set release buildType signingConfig
            if re.search(r'buildTypes\s*\{[\s\S]*?release\s*\{[\s\S]*?signingConfig\s*=\s*signingConfigs', s):
                s = re.sub(r'(buildTypes\s*\{[\s\S]*?release\s*\{[\s\S]*?)signingConfig\s*=\s*signingConfigs[^\n]*', r'\1signingConfig = signingConfigs.getByName("release")', s, count=1)
            else:
                s = re.sub(r'(buildTypes\s*\{[\s\S]*?release\s*\{)', r'\1\n            signingConfig = signingConfigs.getByName("release")', s, count=1)
        else:
            pre = (
                "def keystoreProperties = new Properties()\n"
                "def keystorePropertiesFile = rootProject.file('key.properties')\n"
                "if (keystorePropertiesFile.exists()) {\n"
                "    keystoreProperties.load(new FileInputStream(keystorePropertiesFile))\n"
                "}\n\n"
            )
            sc = (
                "\n    signingConfigs {\n"
                "        release {\n"
                "            keyAlias keystoreProperties['keyAlias']\n"
                "            keyPassword keystoreProperties['keyPassword']\n"
                "            storeFile keystoreProperties['storeFile'] ? file(keystoreProperties['storeFile']) : null\n"
                "            storePassword keystoreProperties['storePassword']\n"
                "            storeType (keystoreProperties['storeType'] ?: 'PKCS12')\n"
                "        }\n"
                "    }\n"
            )
            if "def keystoreProperties" not in s:
                s = pre + s
            m = re.search(r'\nandroid\s*\{', s)
            if m:
                s = s[:m.end()] + sc + s[m.end():]
            if re.search(r'buildTypes\s*\{[\s\S]*?release\s*\{[\s\S]*?signingConfig\s+signingConfigs\.\w+', s):
                s = re.sub(r'(buildTypes\s*\{[\s\S]*?release\s*\{[\s\S]*?)signingConfig\s+signingConfigs\.\w+', r'\1signingConfig signingConfigs.release', s, count=1)
            else:
                s = re.sub(r'(buildTypes\s*\{[\s\S]*?release\s*\{)', r'\1\n            signingConfig signingConfigs.release', s, count=1)
        p.write_text(s, encoding='utf-8')
        print(f'patched release signing in {p}')
        patched_any = True
    if not patched_any:
        print('no gradle file patched (not found or already configured)')

if __name__ == '__main__':
    patch()
