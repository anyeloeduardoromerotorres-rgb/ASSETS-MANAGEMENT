const baseConfig = require("./app.json");

const truthy = (value) => ["1", "true", "yes"].includes(String(value).toLowerCase());

function withoutPlugin(plugins, pluginName) {
  return (plugins ?? []).filter((plugin) => {
    if (typeof plugin === "string") return plugin !== pluginName;
    if (Array.isArray(plugin)) return plugin[0] !== pluginName;
    return true;
  });
}

module.exports = () => {
  const config = structuredClone(baseConfig.expo);
  const usesCleartextTraffic = truthy(process.env.ANDROID_USES_CLEARTEXT);

  config.android = {
    ...(config.android ?? {}),
    usesCleartextTraffic,
  };

  config.plugins = [
    ...withoutPlugin(config.plugins, "expo-build-properties"),
    [
      "expo-build-properties",
      {
        android: {
          usesCleartextTraffic,
        },
      },
    ],
  ];

  return config;
};
