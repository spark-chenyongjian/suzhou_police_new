/**
 * Plugin/Skill 加载器
 *
 * 系统启动时扫描 plugins/ 和 skills/ 目录，
 * 自动注册 Plugin 定义的 Agent 行为和 Skill 工具。
 *
 * 参考 design.md §3.7
 */

import { existsSync, readdirSync, readFileSync } from "fs";
import { join } from "path";
import { parse as parseYaml } from "yaml";

export interface PluginAgentDef {
  extends: string;
  systemPrompt?: string;
  tools?: string[];
}

export interface PluginDefinition {
  name: string;
  version: string;
  description: string;
  agents?: Record<string, PluginAgentDef>;
  promptEnhancements?: { mainAgent?: string };
  tools?: string[];
  reportTemplates?: Array<{ name: string; template: string }>;
  enabled: boolean;
  dir: string;
}

export interface SkillDefinition {
  name: string;
  description: string;
  triggers?: {
    fileTypes?: string[];
    keywords?: string[];
  };
  tools?: Array<{
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
  }>;
  execution?: {
    type: "python-subprocess" | "builtin";
    script?: string;
  };
  enabled: boolean;
  dir: string;
}

const _plugins = new Map<string, PluginDefinition>();
const _skills = new Map<string, SkillDefinition>();

export function loadPlugins(baseDir?: string): void {
  const dir = baseDir || join(process.cwd(), "plugins");
  if (!existsSync(dir)) return;

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const pluginDir = join(dir, entry.name);
    const configPath = join(pluginDir, "plugin.yaml");
    if (!existsSync(configPath)) continue;

    try {
      const raw = readFileSync(configPath, "utf-8");
      const config = parseYaml(raw) as Omit<PluginDefinition, "enabled" | "dir">;
      const plugin: PluginDefinition = { ...config, enabled: true, dir: pluginDir };
      _plugins.set(plugin.name, plugin);
      console.log(`[Plugins] Loaded: ${plugin.name} v${plugin.version}`);
    } catch (err) {
      console.warn(`[Plugins] Failed to load ${entry.name}:`, err);
    }
  }
}

export function loadSkills(baseDir?: string): void {
  const dir = baseDir || join(process.cwd(), "skills");
  if (!existsSync(dir)) return;

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const skillDir = join(dir, entry.name);
    const configPath = join(skillDir, "skill.yaml");
    if (!existsSync(configPath)) continue;

    try {
      const raw = readFileSync(configPath, "utf-8");
      const config = parseYaml(raw) as Omit<SkillDefinition, "enabled" | "dir">;
      const skill: SkillDefinition = { ...config, enabled: true, dir: skillDir };
      _skills.set(skill.name, skill);
      console.log(`[Skills] Loaded: ${skill.name}`);
    } catch (err) {
      console.warn(`[Skills] Failed to load ${entry.name}:`, err);
    }
  }
}

export function getPlugins(): PluginDefinition[] {
  return [..._plugins.values()].filter((p) => p.enabled);
}

export function getSkills(): SkillDefinition[] {
  return [..._skills.values()].filter((s) => s.enabled);
}

export function getPlugin(name: string): PluginDefinition | undefined {
  return _plugins.get(name);
}

export function getSkill(name: string): SkillDefinition | undefined {
  return _skills.get(name);
}

/** Get all prompt enhancements from enabled plugins */
export function getPluginPromptEnhancements(): string {
  const enhancements: string[] = [];
  for (const plugin of getPlugins()) {
    if (plugin.promptEnhancements?.mainAgent) {
      enhancements.push(`\n## Plugin: ${plugin.name}\n${plugin.promptEnhancements.mainAgent}`);
    }
  }
  return enhancements.join("\n");
}
