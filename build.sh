#!/bin/sh

echo "clearing all current directory but build.sh and .git"
find . -maxdepth 1 -mindepth 1 ! -name "build.sh" ! -name ".git" -exec rm -rf {} +

echo "cloneing @stylexjs/unplugin@latest from npm"
mkdir -p tmp
cd tmp
echo '{"name": "stylex-unplugin"}' > package.json
npm install @stylexjs/unplugin@latest

cp -r ./node_modules/@stylexjs/unplugin/* ../
cd ..
rm -rf tmp

echo "applying our patch"
awk 'NR==337{print; print "    transformInclude(id) { return !/\\.(png|jpe?g|gif|webp|svg|woff2?|ttf|otf|eot|mp4|mov|webm|mkv|json)$/i.test(id);},"; next}1' lib/index.js > tmp.js && mv tmp.js lib/index.js

sed -i '' 's/"name": "@stylexjs\/unplugin",/"name": "stylex-unplugin",/g' package.json
