"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.unplugin = exports.default = void 0;
var _unplugin = require("unplugin");
var _core = require("@babel/core");
var _babelPlugin = _interopRequireDefault(require("@stylexjs/babel-plugin"));
var _pluginSyntaxFlow = _interopRequireDefault(require("@babel/plugin-syntax-flow"));
var _pluginSyntaxJsx = _interopRequireDefault(require("@babel/plugin-syntax-jsx"));
var _pluginSyntaxTypescript = _interopRequireDefault(require("@babel/plugin-syntax-typescript"));
var _nodePath = _interopRequireDefault(require("node:path"));
var _nodeFs = _interopRequireDefault(require("node:fs"));
var _promises = _interopRequireDefault(require("node:fs/promises"));
var _nodeModule = require("node:module");
var _lightningcss = require("lightningcss");
var _browserslist = _interopRequireDefault(require("browserslist"));
var _devInjectMiddleware = require("./dev-inject-middleware");
var _consts = require("./consts");
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
function pickCssAssetFromRollupBundle(bundle, choose) {
  const assets = Object.values(bundle).filter(a => a && a.type === 'asset' && typeof a.fileName === 'string' && a.fileName.endsWith('.css'));
  if (assets.length === 0) return null;
  if (typeof choose === 'function') {
    const chosen = assets.find(a => choose(a.fileName));
    if (chosen) return chosen;
  }
  const best = assets.find(a => /(^|\/)index\.css$/.test(a.fileName)) || assets.find(a => /(^|\/)style\.css$/.test(a.fileName));
  return best || assets[0];
}
function processCollectedRulesToCSS(rules, options) {
  if (!rules || rules.length === 0) return '';
  const collectedCSS = _babelPlugin.default.processStylexRules(rules, {
    useLayers: !!options.useCSSLayers,
    enableLTRRTLComments: options?.enableLTRRTLComments
  });
  const {
    code
  } = (0, _lightningcss.transform)({
    targets: (0, _lightningcss.browserslistToTargets)((0, _browserslist.default)('>= 1%')),
    ...options.lightningcssOptions,
    filename: 'stylex.css',
    code: Buffer.from(collectedCSS)
  });
  return code.toString();
}
function getAssetBaseName(asset) {
  if (asset?.name && typeof asset.name === 'string') return asset.name;
  const fallback = asset?.fileName ? _nodePath.default.basename(asset.fileName) : 'stylex.css';
  const match = /^(.*?)(-[a-z0-9]{8,})?\.css$/i.exec(fallback);
  if (match) return `${match[1]}.css`;
  return fallback || 'stylex.css';
}
function replaceBundleReferences(bundle, oldFileName, newFileName) {
  for (const item of Object.values(bundle)) {
    if (!item) continue;
    if (item.type === 'chunk') {
      if (typeof item.code === 'string' && item.code.includes(oldFileName)) {
        item.code = item.code.split(oldFileName).join(newFileName);
      }
      const importedCss = item.viteMetadata?.importedCss;
      if (importedCss instanceof Set && importedCss.has(oldFileName)) {
        importedCss.delete(oldFileName);
        importedCss.add(newFileName);
      } else if (Array.isArray(importedCss)) {
        const next = importedCss.map(name => name === oldFileName ? newFileName : name);
        item.viteMetadata.importedCss = next;
      }
    } else if (item.type === 'asset' && typeof item.source === 'string') {
      if (item.source.includes(oldFileName)) {
        item.source = item.source.split(oldFileName).join(newFileName);
      }
    }
  }
}
function replaceCssAssetWithHashedCopy(ctx, bundle, asset, nextSource) {
  const baseName = getAssetBaseName(asset);
  const referenceId = ctx.emitFile({
    type: 'asset',
    name: baseName,
    source: nextSource
  });
  const nextFileName = ctx.getFileName(referenceId);
  const oldFileName = asset.fileName;
  if (!nextFileName || !oldFileName || nextFileName === oldFileName) {
    asset.source = nextSource;
    return;
  }
  replaceBundleReferences(bundle, oldFileName, nextFileName);
  const emitted = bundle[nextFileName];
  if (emitted && emitted !== asset) {
    delete bundle[nextFileName];
  }
  asset.fileName = nextFileName;
  asset.source = nextSource;
  if (bundle[oldFileName] === asset) {
    delete bundle[oldFileName];
  }
  bundle[nextFileName] = asset;
}
function readJSON(file) {
  try {
    const content = _nodeFs.default.readFileSync(file, 'utf8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}
function findNearestPackageJson(startDir) {
  let dir = startDir;
  for (;;) {
    const candidate = _nodePath.default.join(dir, 'package.json');
    if (_nodeFs.default.existsSync(candidate)) return candidate;
    const parent = _nodePath.default.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}
function toPackageName(importSource) {
  const source = typeof importSource === 'string' ? importSource : importSource?.from;
  if (!source || source.startsWith('.') || source.startsWith('/')) return null;
  if (source.startsWith('@')) {
    const [scope, name] = source.split('/');
    if (scope && name) return `${scope}/${name}`;
  }
  const [pkg] = source.split('/');
  return pkg || null;
}
function hasStylexDependency(manifest, targetPackages) {
  if (!manifest || typeof manifest !== 'object') return false;
  const depFields = ['dependencies', 'peerDependencies', 'optionalDependencies'];
  for (const field of depFields) {
    const deps = manifest[field];
    if (!deps || typeof deps !== 'object') continue;
    for (const name of Object.keys(deps)) {
      if (targetPackages.has(name)) return true;
    }
  }
  return false;
}
function discoverStylexPackages({
  importSources,
  explicitPackages,
  rootDir,
  resolver
}) {
  const targetPackages = new Set(importSources.map(toPackageName).filter(Boolean).concat(['@stylexjs/stylex']));
  const found = new Set(explicitPackages || []);
  const pkgJsonPath = findNearestPackageJson(rootDir);
  if (!pkgJsonPath) return Array.from(found);
  const pkgDir = _nodePath.default.dirname(pkgJsonPath);
  const pkgJson = readJSON(pkgJsonPath);
  if (!pkgJson) return Array.from(found);
  const depFields = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'];
  const deps = new Set();
  for (const field of depFields) {
    const entries = pkgJson[field];
    if (!entries || typeof entries !== 'object') continue;
    for (const name of Object.keys(entries)) deps.add(name);
  }
  for (const dep of deps) {
    let manifestPath = null;
    try {
      manifestPath = resolver.resolve(`${dep}/package.json`, {
        paths: [pkgDir]
      });
    } catch {}
    if (!manifestPath) continue;
    const manifest = readJSON(manifestPath);
    if (hasStylexDependency(manifest, targetPackages)) {
      found.add(dep);
    }
  }
  return Array.from(found);
}
const unpluginInstance = (0, _unplugin.createUnplugin)((userOptions = {}, metaOptions) => {
  const framework = metaOptions?.framework;
  const {
    dev = process.env.NODE_ENV === 'development' || process.env.BABEL_ENV === 'development',
    unstable_moduleResolution = {
      type: 'commonJS',
      rootDir: process.cwd()
    },
    babelConfig: {
      plugins = [],
      presets = []
    } = {},
    importSources = ['stylex', '@stylexjs/stylex'],
    useCSSLayers = false,
    lightningcssOptions,
    cssInjectionTarget,
    externalPackages = [],
    devPersistToDisk = false,
    devMode = 'full',
    treeshakeCompensation = ['vite', 'rollup', 'rolldown'].includes(framework),
    ...stylexOptions
  } = userOptions;
  const stylexRulesById = new Map();
  function getSharedStore() {
    try {
      const g = globalThis;
      if (!g.__stylex_unplugin_store) {
        g.__stylex_unplugin_store = {
          rulesById: new Map(),
          version: 0
        };
      }
      return g.__stylex_unplugin_store;
    } catch {
      return {
        rulesById: stylexRulesById,
        version: 0
      };
    }
  }
  let viteServer = null;
  let viteOutDir = null;
  const nearestPkgJson = findNearestPackageJson(process.cwd());
  const requireFromCwd = nearestPkgJson ? (0, _nodeModule.createRequire)(nearestPkgJson) : (0, _nodeModule.createRequire)(_nodePath.default.join(process.cwd(), 'package.json'));
  const stylexPackages = discoverStylexPackages({
    importSources,
    explicitPackages: externalPackages,
    rootDir: nearestPkgJson ? _nodePath.default.dirname(nearestPkgJson) : process.cwd(),
    resolver: requireFromCwd
  });
  function findNearestNodeModules(startDir) {
    let dir = startDir;
    for (;;) {
      const candidate = _nodePath.default.join(dir, 'node_modules');
      if (_nodeFs.default.existsSync(candidate)) {
        const stat = _nodeFs.default.statSync(candidate);
        if (stat.isDirectory()) return candidate;
      }
      const parent = _nodePath.default.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
    return null;
  }
  const NEAREST_NODE_MODULES = findNearestNodeModules(process.cwd());
  const DISK_RULES_DIR = NEAREST_NODE_MODULES ? _nodePath.default.join(NEAREST_NODE_MODULES, '.stylex') : _nodePath.default.join(process.cwd(), 'node_modules', '.stylex');
  const DISK_RULES_PATH = _nodePath.default.join(DISK_RULES_DIR, 'rules.json');
  async function runBabelTransform(inputCode, filename, callerName) {
    const result = await (0, _core.transformAsync)(inputCode, {
      babelrc: false,
      filename,
      presets,
      plugins: [...plugins, /\.jsx?/.test(_nodePath.default.extname(filename)) ? _pluginSyntaxFlow.default : [_pluginSyntaxTypescript.default, {
        isTSX: true
      }], _pluginSyntaxJsx.default, _babelPlugin.default.withOptions({
        ...stylexOptions,
        importSources,
        treeshakeCompensation,
        dev,
        unstable_moduleResolution
      })],
      caller: {
        name: callerName,
        supportsStaticESM: true,
        supportsDynamicImport: true,
        supportsTopLevelAwait: !inputCode.includes('require('),
        supportsExportNamespaceFrom: true
      }
    });
    if (!result || result.code == null) {
      return {
        code: inputCode,
        map: null,
        metadata: {}
      };
    }
    return result;
  }
  function escapeReg(src) {
    return src.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  function containsStylexImport(code, source) {
    const s = escapeReg(typeof source === 'string' ? source : source.from);
    const re = new RegExp(`(?:from\\s*['"]${s}['"]|import\\s*\\(\\s*['"]${s}['"]\\s*\\)|require\\s*\\(\\s*['"]${s}['"]\\s*\\)|^\\s*import\\s*['"]${s}['"])`, 'm');
    return re.test(code);
  }
  function shouldHandle(code) {
    if (!code) return false;
    return importSources.some(src => containsStylexImport(code, src));
  }
  function resetState() {
    stylexRulesById.clear();
    if (devPersistToDisk) {
      try {
        _nodeFs.default.rmSync(DISK_RULES_PATH, {
          force: true
        });
      } catch {}
    }
  }
  function collectCss() {
    const merged = new Map();
    if (devPersistToDisk) {
      try {
        if (_nodeFs.default.existsSync(DISK_RULES_PATH)) {
          const json = JSON.parse(_nodeFs.default.readFileSync(DISK_RULES_PATH, 'utf8'));
          for (const [k, v] of Object.entries(json)) merged.set(k, v);
        }
      } catch {}
    }
    try {
      const shared = getSharedStore().rulesById;
      for (const [k, v] of shared.entries()) merged.set(k, v);
    } catch {}
    for (const [k, v] of stylexRulesById.entries()) merged.set(k, v);
    const allRules = Array.from(merged.values()).flat();
    return processCollectedRulesToCSS(allRules, {
      useCSSLayers,
      lightningcssOptions,
      enableLTRRTLComments: stylexOptions?.enableLTRRTLComments
    });
  }
  async function persistRulesToDisk(id, rules) {
    if (!devPersistToDisk) return;
    try {
      let current = {};
      try {
        const txt = await _promises.default.readFile(DISK_RULES_PATH, 'utf8');
        current = JSON.parse(txt);
      } catch {}
      if (rules && Array.isArray(rules) && rules.length > 0) {
        current[id] = rules;
      } else if (current[id]) {
        delete current[id];
      }
      await _promises.default.writeFile(DISK_RULES_PATH, JSON.stringify(current), 'utf8');
    } catch {}
  }
  return {
    name: '@stylexjs/unplugin',
    transformInclude(id) { return !/\.(png|jpe?g|gif|webp|svg|svgx|woff2?|ttf|otf|eot|mp3|ogg|mp4|mov|webm|mkv|json)$/i.test(id);},
    apply: (config, env) => {
      try {
        const command = env?.command || (typeof config === 'string' ? undefined : undefined);
        if (devMode === 'off' && command === 'serve') return false;
      } catch {}
      return true;
    },
    enforce: 'pre',
    buildStart() {
      resetState();
    },
    buildEnd() {},
    async transform(code, id) {
      const JS_LIKE_RE = /\.[cm]?[jt]sx?(\?|$)/;
      if (!JS_LIKE_RE.test(id)) return null;
      if (!shouldHandle(code)) return null;
      const dir = _nodePath.default.dirname(id);
      const basename = _nodePath.default.basename(id);
      const file = _nodePath.default.join(dir, basename.split('?')[0] || basename);
      const result = await runBabelTransform(code, file, '@stylexjs/unplugin');
      const {
        metadata
      } = result;
      if (!stylexOptions.runtimeInjection) {
        const hasRules = metadata && Array.isArray(metadata.stylex) && metadata.stylex.length > 0;
        const shared = getSharedStore();
        if (hasRules) {
          stylexRulesById.set(id, metadata.stylex);
          shared.rulesById.set(id, metadata.stylex);
          shared.version++;
          await persistRulesToDisk(id, metadata.stylex);
        } else {
          stylexRulesById.delete(id);
          if (shared.rulesById.has(id)) {
            shared.rulesById.delete(id);
            shared.version++;
          }
          await persistRulesToDisk(id, []);
        }
        if (viteServer) {
          try {
            viteServer.ws.send({
              type: 'custom',
              event: 'stylex:css-update'
            });
          } catch {}
        }
      }
      const ctx = this;
      if (ctx && ctx.meta && ctx.meta.watchMode && typeof ctx.parse === 'function') {
        try {
          const ast = ctx.parse(result.code);
          for (const stmt of ast.body) {
            if (stmt.type === 'ImportDeclaration') {
              const resolved = await ctx.resolve(stmt.source.value, id);
              if (resolved && !resolved.external) {
                const loaded = await ctx.load(resolved);
                if (loaded && loaded.meta && 'stylex' in loaded.meta) {
                  stylexRulesById.set(resolved.id, loaded.meta.stylex);
                }
              }
            }
          }
        } catch {}
      }
      return {
        code: result.code,
        map: result.map
      };
    },
    shouldTransformCachedModule({
      id,
      meta
    }) {
      if (meta && 'stylex' in meta) {
        stylexRulesById.set(id, meta.stylex);
      }
      return false;
    },
    generateBundle(_opts, bundle) {
      const css = collectCss();
      if (!css) return;
      const target = pickCssAssetFromRollupBundle(bundle, cssInjectionTarget);
      if (target) {
        const current = typeof target.source === 'string' ? target.source : target.source?.toString() || '';
        const nextSource = current ? current + '\n' + css : css;
        replaceCssAssetWithHashedCopy(this, bundle, target, nextSource);
      } else {}
    },
    vite: devMode === 'off' ? undefined : {
      config(config) {
        if (!stylexPackages || stylexPackages.length === 0) return;
        const addExcludes = (existing = []) => Array.from(new Set([...existing, ...stylexPackages]));
        return {
          optimizeDeps: {
            ...(config?.optimizeDeps || {}),
            exclude: addExcludes(config?.optimizeDeps?.exclude || [])
          },
          ssr: {
            ...(config?.ssr || {}),
            optimizeDeps: {
              ...(config?.ssr?.optimizeDeps || {}),
              exclude: addExcludes(config?.ssr?.optimizeDeps?.exclude || [])
            }
          }
        };
      },
      configResolved(config) {
        try {
          viteOutDir = config.build?.outDir || viteOutDir;
        } catch {}
      },
      configureServer(server) {
        viteServer = server;
        if (devMode === 'full') {
          server.middlewares.use(_devInjectMiddleware.devInjectMiddleware);
        }
        server.middlewares.use((req, res, next) => {
          if (!req.url) return next();
          if (req.url.startsWith(_consts.DEV_CSS_PATH)) {
            res.statusCode = 200;
            res.setHeader('Content-Type', 'text/css');
            res.setHeader('Cache-Control', 'no-store');
            const css = collectCss();
            res.end(css || '');
            return;
          }
          next();
        });
        const shared = getSharedStore();
        let lastVersion = shared.version;
        const interval = setInterval(() => {
          const curr = shared.version;
          if (curr !== lastVersion) {
            lastVersion = curr;
            try {
              server.ws.send({
                type: 'custom',
                event: 'stylex:css-update'
              });
            } catch {}
          }
        }, 150);
        server.httpServer?.once('close', () => clearInterval(interval));
      },
      resolveId(id) {
        if (devMode === 'full' && id.includes('virtual:stylex:runtime')) return id;
        if (devMode === 'css-only' && id.includes('virtual:stylex:css-only')) return id;
        return null;
      },
      load(id) {
        if (devMode === 'full' && id.includes('virtual:stylex:runtime')) {
          return _consts.VIRTUAL_STYLEX_RUNTIME_SCRIPT;
        }
        if (devMode === 'css-only' && id.includes('virtual:stylex:css-only')) {
          return _consts.VIRTUAL_STYLEX_CSS_ONLY_SCRIPT;
        }
        return null;
      },
      transformIndexHtml() {
        if (devMode !== 'full') return null;
        if (!viteServer) return null;
        const base = viteServer.config.base ?? '';
        return [{
          tag: 'script',
          attrs: {
            type: 'module',
            src: _nodePath.default.join(base, '/@id/virtual:stylex:runtime')
          },
          injectTo: 'head'
        }, {
          tag: 'link',
          attrs: {
            rel: 'stylesheet',
            href: _nodePath.default.join(base, _consts.DEV_CSS_PATH)
          },
          injectTo: 'head'
        }];
      },
      handleHotUpdate(ctx) {
        const base = ctx.server.config.base ?? '';
        const cssMod = ctx.server.moduleGraph.getModuleById(_nodePath.default.join(base, 'virtual:stylex:css-module'));
        if (cssMod) {
          ctx.server.moduleGraph.invalidateModule(cssMod);
        }
        try {
          ctx.server.ws.send({
            type: 'custom',
            event: 'stylex:css-update'
          });
        } catch {}
      }
    },
    webpack(compiler) {
      const PLUGIN_NAME = '@stylexjs/unplugin';
      compiler.hooks.thisCompilation.tap(PLUGIN_NAME, compilation => {
        resetState();
        const wp = compiler.webpack || compiler.rspack || undefined;
        const stage = wp?.Compilation?.PROCESS_ASSETS_STAGE_SUMMARIZE;
        const tapOptions = stage != null ? {
          name: PLUGIN_NAME,
          stage
        } : PLUGIN_NAME;
        const toRawSource = content => {
          const RawSource = wp?.sources?.RawSource;
          return RawSource ? new RawSource(content) : {
            source: () => content,
            size: () => Buffer.byteLength(content)
          };
        };
        compilation.hooks.processAssets.tap(tapOptions, assets => {
          const css = collectCss();
          if (!css) return;
          const cssAssets = Object.keys(assets).filter(f => f.endsWith('.css'));
          if (cssAssets.length === 0) {
            compilation.warnings.push(new Error('[stylex] No CSS asset found to inject into. Skipping.'));
            return;
          }
          const pickName = typeof cssInjectionTarget === 'function' && cssAssets.find(f => cssInjectionTarget(f)) || cssAssets.find(f => /(^|\/)index\.css$/.test(f)) || cssAssets.find(f => /(^|\/)style\.css$/.test(f)) || cssAssets[0];
          const asset = compilation.getAsset(pickName);
          if (!asset) return;
          const existing = asset.source.source().toString();
          const next = existing ? existing + '\n' + css : css;
          compilation.updateAsset(pickName, toRawSource(next));
        });
      });
    },
    rspack(compiler) {
      this.webpack?.(compiler);
    },
    esbuild: {
      name: '@stylexjs/unplugin',
      setup(build) {
        build.onEnd(async result => {
          try {
            const css = collectCss();
            if (!css) return;
            const initial = build.initialOptions;
            const outDir = initial.outdir || (initial.outfile ? _nodePath.default.dirname(initial.outfile) : null);
            if (!outDir) return;
            let outfile = null;
            const meta = result && result.metafile;
            if (meta && meta.outputs) {
              const outputs = Object.keys(meta.outputs);
              const cssOutputs = outputs.filter(f => f.endsWith('.css'));
              const pick = cssOutputs.find(f => /(^|\/)index\.css$/.test(f)) || cssOutputs.find(f => /(^|\/)style\.css$/.test(f)) || cssOutputs[0];
              if (pick) outfile = _nodePath.default.isAbsolute(pick) ? pick : _nodePath.default.join(process.cwd(), pick);
            } else {
              try {
                const files = _nodeFs.default.readdirSync(outDir).filter(f => f.endsWith('.css'));
                const pick = files.find(f => /(^|\/)index\.css$/.test(f)) || files.find(f => /(^|\/)style\.css$/.test(f)) || files[0];
                if (pick) outfile = _nodePath.default.join(outDir, pick);
              } catch {}
            }
            if (!outfile) {
              const fallback = _nodePath.default.join(outDir, 'stylex.css');
              await _promises.default.mkdir(_nodePath.default.dirname(fallback), {
                recursive: true
              });
              await _promises.default.writeFile(fallback, css, 'utf8');
              return;
            }
            try {
              const current = _nodeFs.default.readFileSync(outfile, 'utf8');
              if (!current.includes(css)) {
                await _promises.default.writeFile(outfile, current ? current + '\n' + css : css, 'utf8');
              }
            } catch {}
          } catch {}
        });
      }
    },
    async writeBundle(options, bundle) {
      try {
        const css = collectCss();
        if (!css) return;
        const target = pickCssAssetFromRollupBundle(bundle, cssInjectionTarget);
        const outDir = options?.dir || (options?.file ? _nodePath.default.dirname(options.file) : viteOutDir);
        if (!outDir) return;
        try {
          await _promises.default.mkdir(outDir, {
            recursive: true
          });
        } catch {}
        let outfile;
        if (!target) {
          try {
            const assetsDir = _nodePath.default.join(outDir, 'assets');
            if (_nodeFs.default.existsSync(assetsDir)) {
              const files = _nodeFs.default.readdirSync(assetsDir).filter(f => f.endsWith('.css'));
              const pick = files.find(f => /(^|\/)index\.css$/.test(f)) || files.find(f => /(^|\/)style\.css$/.test(f)) || files[0];
              if (pick) outfile = _nodePath.default.join(assetsDir, pick);
            }
          } catch {}
          if (!outfile) {
            const assetsDir = _nodePath.default.join(outDir, 'assets');
            try {
              await _promises.default.mkdir(assetsDir, {
                recursive: true
              });
            } catch {}
            const fallback = _nodePath.default.join(assetsDir, 'stylex.css');
            await _promises.default.writeFile(fallback, css, 'utf8');
            return;
          }
        } else {
          outfile = _nodePath.default.join(outDir, target.fileName);
        }
        try {
          const current = _nodeFs.default.readFileSync(outfile, 'utf8');
          if (!current.includes(css)) {
            await _promises.default.writeFile(outfile, current ? current + '\n' + css : css, 'utf8');
          }
        } catch {}
      } catch {}
    }
  };
});
var _default = exports.default = unpluginInstance;
const unplugin = exports.unplugin = unpluginInstance;
