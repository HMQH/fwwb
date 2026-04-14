---
name: react-native-skills
description: React Native 和 Expo 高性能移动应用程序开发最佳实践。用于 React Native 组件、列表和滚动优化，实现 Reanimated 动画、图像和媒体、字体、Expo 和平台 API。
---

# React Native Skills

Comprehensive best practices for React Native and Expo applications. Read only the rule files relevant to the current task instead of loading the entire ruleset at once.

## When to Apply

Use this skill when:

- Building or refactoring React Native or Expo apps
- Optimizing list or scroll performance
- Implementing animations with Reanimated or gesture-driven interactions
- Working with images, media, fonts, menus, modals, or native modules
- Handling navigation, monorepo native dependencies, or other native platform APIs

## Recommended Reading Order

1. ules/list-performance-*.md and ules/scroll-*.md
2. ules/animation-*.md
3. ules/navigation-*.md
4. ules/ui-*.md
5. ules/react-state-*.md, ules/state-*.md, and ules/react-compiler-*.md
6. ules/rendering-*.md
7. ules/monorepo-*.md, ules/fonts-*.md, ules/imports-*.md, and ules/js-*.md

## How to Use

1. Identify the category that matches the task.
2. Open the smallest relevant set of rule files in ules/.
3. Apply the rules directly in code changes instead of returning a checklist only.
4. Use ules/_sections.md for category descriptions and priorities.
5. Use ules/_template.md if you need to author new rules.
6. Use metadata.json for the original summary and reference links.