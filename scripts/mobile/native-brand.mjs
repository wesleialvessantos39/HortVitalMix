import sharp from 'sharp';
import { readdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { repositoryRoot, nativeRoot } from './native-build.mjs';
const icon = await readFile(path.join(repositoryRoot, 'public/favicon.svg'));
const resources = path.join(nativeRoot, 'android/app/src/main/res');
for (const directory of await readdir(resources)) {
  if (directory.startsWith('drawable-')) {
    try { await unlink(path.join(resources, directory, 'splash.png')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
}
try { await unlink(path.join(resources, 'drawable/splash.png')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
await writeFile(path.join(resources, 'drawable/hvm_leaf.xml'), '<vector xmlns:android="http://schemas.android.com/apk/res/android" android:width="108dp" android:height="108dp" android:viewportWidth="108" android:viewportHeight="108"><group android:translateX="22" android:translateY="22"><path android:fillColor="#E8F5E9" android:pathData="M16,43C13,20 30,13 49,14c0,23 -12,36 -30,30L38,25Z"/></group></vector>\n');
await writeFile(path.join(resources, 'drawable/splash.xml'), '<layer-list xmlns:android="http://schemas.android.com/apk/res/android"><item android:drawable="@color/ic_launcher_background"/><item android:gravity="center" android:drawable="@drawable/hvm_leaf"/></layer-list>\n');
await writeFile(path.join(resources, 'values/ic_launcher_background.xml'), '<resources><color name="ic_launcher_background">#1B4D2E</color></resources>\n');
await writeFile(path.join(resources, 'drawable/ic_launcher_background.xml'), '<shape xmlns:android="http://schemas.android.com/apk/res/android"><solid android:color="#1B4D2E"/></shape>\n');
for (const density of [['mdpi',48],['hdpi',72],['xhdpi',96],['xxhdpi',144],['xxxhdpi',192]]) {
 const png=await sharp(icon).resize(density[1],density[1]).flatten({background:'#1B4D2E'}).png().toBuffer();
 for (const name of ['ic_launcher.png','ic_launcher_round.png']) await writeFile(path.join(resources,`mipmap-${density[0]}`,name),png);
 const foreground=await sharp(icon).resize(Math.round(density[1]*1.5)).png().toBuffer();
 await writeFile(path.join(resources,`mipmap-${density[0]}/ic_launcher_foreground.png`),foreground);
}
for (const name of ['ic_launcher.xml','ic_launcher_round.xml']) await writeFile(path.join(resources,`mipmap-anydpi-v26/${name}`), '<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android"><background android:drawable="@color/ic_launcher_background"/><foreground android:drawable="@drawable/hvm_leaf"/></adaptive-icon>\n');
await writeFile(path.join(resources,'drawable-v24/ic_launcher_foreground.xml'), await readFile(path.join(resources,'drawable/hvm_leaf.xml')));
const assets=path.join(nativeRoot,'ios/App/App/Assets.xcassets');
await sharp(icon).resize(1024,1024).flatten({background:'#1B4D2E'}).png().toFile(path.join(assets,'AppIcon.appiconset/AppIcon-512@2x.png'));
const center=await sharp(icon).resize(420,420).png().toBuffer();
const splash=await sharp({create:{width:2732,height:2732,channels:4,background:'#1B4D2E'}}).composite([{input:center,gravity:'centre'}]).png().toBuffer();
for(const name of ['splash-2732x2732.png','splash-2732x2732-1.png','splash-2732x2732-2.png']) await writeFile(path.join(assets,'Splash.imageset',name),splash);
process.stdout.write('Native HortiVitalMix icons and splash generated from public/favicon.svg.\n');
