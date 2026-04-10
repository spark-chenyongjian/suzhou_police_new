import { Hono } from "hono";
import { getPlugins, getPlugin, getSkills } from "../../plugins/loader.js";

export const pluginRoutes = new Hono();

pluginRoutes.get("/", (c) => {
  const plugins = getPlugins().map((p) => ({
    name: p.name,
    version: p.version,
    description: p.description,
    agents: p.agents ? Object.keys(p.agents) : [],
    reportTemplates: p.reportTemplates?.map((t) => t.name) ?? [],
    enabled: p.enabled,
  }));
  return c.json(plugins);
});

pluginRoutes.get("/skills", (c) => {
  const skills = getSkills().map((s) => ({
    name: s.name,
    description: s.description,
    enabled: s.enabled,
  }));
  return c.json(skills);
});

pluginRoutes.patch("/:name/toggle", (c) => {
  const name = c.req.param("name");
  const plugin = getPlugin(name);
  if (!plugin) return c.json({ error: "Plugin not found" }, 404);
  plugin.enabled = !plugin.enabled;
  return c.json({ name, enabled: plugin.enabled });
});
