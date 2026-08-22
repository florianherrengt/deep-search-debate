import js from "@eslint/js"
import tseslint from "typescript-eslint"
import eslintReact from "@eslint-react/eslint-plugin"
import vitest from "@vitest/eslint-plugin"
import playwright from "eslint-plugin-playwright"
import reactHooks from "eslint-plugin-react-hooks"
import reactRefresh from "eslint-plugin-react-refresh"

const noOutlinedAccordion = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow the outlined variant on MUI Accordion to keep full-width disclosure rows borderless.",
    },
    messages: {
      outlinedAccordion:
        'Accordion must not use variant="outlined". Use the page\'s default borderless accordion styling.',
    },
    schema: [],
  },
  create(context) {
    return {
      JSXOpeningElement(node) {
        if (
          node.name.type !== "JSXIdentifier" ||
          node.name.name !== "Accordion"
        ) {
          return
        }

        const variant = node.attributes.find(
          (attribute) =>
            attribute.type === "JSXAttribute" &&
            attribute.name.type === "JSXIdentifier" &&
            attribute.name.name === "variant",
        )
        if (!variant) return

        const value = variant.value
        const isOutlined =
          (value?.type === "Literal" && value.value === "outlined") ||
          (value?.type === "JSXExpressionContainer" &&
            value.expression.type === "Literal" &&
            value.expression.value === "outlined")

        if (isOutlined) {
          context.report({ node: variant, messageId: "outlinedAccordion" })
        }
      },
    }
  },
}

const noSquareCorners = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow zero-radius corners on MUI surfaces: the square prop on any component, and TableContainer without borderRadius in sx.",
    },
    messages: {
      squareProp:
        'Avoid the square prop on "{{name}}" — it forces zero corner radius, violating the app\'s rounded-surface policy. Use explicit borderRadius overrides instead.',
      tableContainerRadius:
        "TableContainer must set a non-zero borderRadius in its sx so the table header band follows the rounded-surface policy.",
    },
    schema: [],
  },
  create(context) {
    // Returns true when the sx attribute provably sets a non-zero
    // borderRadius, or when its shape cannot be analyzed (spread, identifier,
    // template) — those are not reported to avoid false positives.
    function hasRoundedRadius(sxAttribute) {
      if (!sxAttribute || sxAttribute.type === "JSXSpreadAttribute") {
        return true
      }
      const value = sxAttribute.value
      if (!value || value.type !== "JSXExpressionContainer") return true
      const expression = value.expression
      const objectExpressions = []
      if (expression.type === "ObjectExpression") {
        objectExpressions.push(expression)
      } else if (expression.type === "ArrowFunctionExpression") {
        const body = expression.body
        if (body.type === "ObjectExpression") {
          objectExpressions.push(body)
        } else if (body.type === "BlockStatement") {
          for (const statement of body.body) {
            if (
              statement.type === "ReturnStatement" &&
              statement.argument?.type === "ObjectExpression"
            ) {
              objectExpressions.push(statement.argument)
            }
          }
        }
      }
      if (objectExpressions.length === 0) return true
      for (const objectExpression of objectExpressions) {
        for (const property of objectExpression.properties) {
          if (property.type !== "Property" || property.computed) continue
          const key = property.key
          if (key.type !== "Identifier" || key.name !== "borderRadius") continue
          const radiusValue = property.value
          if (
            radiusValue.type === "Literal" &&
            (radiusValue.value === 0 || radiusValue.value === "0")
          ) {
            return false
          }
          return true
        }
      }
      return false
    }

    return {
      JSXOpeningElement(node) {
        for (const attribute of node.attributes) {
          if (
            attribute.type !== "JSXAttribute" ||
            attribute.name.type !== "JSXIdentifier" ||
            attribute.name.name !== "square"
          ) {
            continue
          }
          const value = attribute.value
          if (
            value?.type === "JSXExpressionContainer" &&
            value.expression.type === "Literal" &&
            value.expression.value === false
          ) {
            continue
          }
          const name =
            node.name.type === "JSXIdentifier"
              ? node.name.name
              : node.name.type === "JSXMemberExpression" &&
                  node.name.property.type === "JSXIdentifier"
                ? node.name.property.name
                : "component"
          context.report({
            node: attribute,
            messageId: "squareProp",
            data: { name },
          })
        }

        if (
          node.name.type !== "JSXIdentifier" ||
          node.name.name !== "TableContainer"
        ) {
          return
        }
        const sxAttribute = node.attributes.find(
          (attribute) =>
            attribute.type === "JSXAttribute" &&
            attribute.name.type === "JSXIdentifier" &&
            attribute.name.name === "sx",
        )
        if (sxAttribute && !hasRoundedRadius(sxAttribute)) {
          context.report({ node: sxAttribute, messageId: "tableContainerRadius" })
        } else if (!sxAttribute) {
          context.report({ node, messageId: "tableContainerRadius" })
        }
      },
    }
  },
}

const noAsymmetricBorders = {
  meta: {
    type: "problem",
    docs: {
      description:
        'Disallow per-side border declarations that make width, style, or color asymmetric: every side must carry the same border, except for a single one-sided divider (e.g. borderTop: 1, borderColor: "divider").',
    },
    messages: {
      asymmetricBorder:
        '"{{prop}}" styles individual sides — borders must be the same all around. Use the all-around border properties, or a MUI Divider for one-sided separators.',
    },
    schema: [],
  },
  create(context) {
    // Which sides each per-side border property styles. Logical start/end
    // sides are mapped with an LTR assumption; both directions are still
    // caught when they combine with other border declarations.
    const PER_SIDE_SIDES = new Map([
      ["borderTop", ["top"]],
      ["borderRight", ["right"]],
      ["borderBottom", ["bottom"]],
      ["borderLeft", ["left"]],
      ["borderX", ["left", "right"]],
      ["borderY", ["top", "bottom"]],
      ["borderInline", ["left", "right"]],
      ["borderBlock", ["top", "bottom"]],
      ["borderInlineStart", ["left"]],
      ["borderInlineEnd", ["right"]],
      ["borderBlockStart", ["top"]],
      ["borderBlockEnd", ["bottom"]],
    ])
    for (const side of ["top", "right", "bottom", "left"]) {
      const capital = side[0].toUpperCase() + side.slice(1)
      for (const suffix of ["Width", "Style", "Color"]) {
        PER_SIDE_SIDES.set(`border${capital}${suffix}`, [side])
      }
    }
    for (const [logical, side] of [
      ["InlineStart", "left"],
      ["InlineEnd", "right"],
      ["BlockStart", "top"],
      ["BlockEnd", "bottom"],
    ]) {
      for (const suffix of ["Width", "Style", "Color"]) {
        PER_SIDE_SIDES.set(`border${logical}${suffix}`, [side])
      }
    }

    // An all-around border width/style makes any per-side declaration an
    // override of the uniform border.
    const ALL_AROUND_WIDTH_STYLE = new Set([
      "border",
      "borderWidth",
      "borderStyle",
    ])

    function keyName(key) {
      if (key.type === "Identifier") return key.name
      if (key.type === "Literal" && typeof key.value === "string") {
        return key.value
      }
      return null
    }

    // Nested objects under selector keys ("&:hover", ".MuiX-root", ":last-of-type")
    // are their own declaration blocks and are checked independently.
    function isSelectorKey(key) {
      const name = keyName(key)
      return name !== null && /^[&:.]/.test(name)
    }

    function checkObject(objectExpression) {
      const perSide = [] // { node, name, sides }
      let allAroundColorLiteral = null
      let hasAllAroundWidthStyle = false

      for (const property of objectExpression.properties) {
        if (property.type !== "Property" || property.computed) continue
        const name = keyName(property.key)
        if (name === null) continue
        if (PER_SIDE_SIDES.has(name)) {
          perSide.push({
            node: property,
            name,
            sides: PER_SIDE_SIDES.get(name),
          })
        } else if (name === "borderColor") {
          if (
            property.value.type === "Literal" &&
            (typeof property.value.value === "string" ||
              typeof property.value.value === "number")
          ) {
            allAroundColorLiteral = property.value.value
          }
        } else if (ALL_AROUND_WIDTH_STYLE.has(name)) {
          hasAllAroundWidthStyle = true
        } else if (
          isSelectorKey(property.key) &&
          property.value.type === "ObjectExpression"
        ) {
          checkObject(property.value)
        }
      }

      // A single one-sided divider (e.g. borderTop: 1, borderColor: "divider")
      // is allowed; anything else is asymmetric: several sides styled,
      // several properties on one side, an override of an all-around
      // width/style, or a per-side color that differs from the all-around one.
      const propsPerSide = new Map()
      for (const entry of perSide) {
        for (const side of entry.sides) {
          propsPerSide.set(side, (propsPerSide.get(side) ?? 0) + 1)
        }
      }
      const styledSides = propsPerSide.size

      for (const entry of perSide) {
        const isViolation =
          hasAllAroundWidthStyle ||
          styledSides >= 2 ||
          entry.sides.some((side) => (propsPerSide.get(side) ?? 0) >= 2) ||
          (allAroundColorLiteral !== null &&
            entry.name.endsWith("Color") &&
            entry.node.value.type === "Literal" &&
            entry.node.value.value !== allAroundColorLiteral)
        if (isViolation) {
          context.report({
            node: entry.node,
            messageId: "asymmetricBorder",
            data: { prop: entry.name },
          })
        }
      }
    }

    function objectExpressionsFromValue(value) {
      if (!value || value.type !== "JSXExpressionContainer") return []
      const expressions = []
      const collect = (node) => {
        if (node.type === "ObjectExpression") {
          expressions.push(node)
        } else if (node.type === "ArrayExpression") {
          for (const element of node.elements) {
            if (element) collect(element)
          }
        } else if (node.type === "ArrowFunctionExpression") {
          const body = node.body
          if (body.type === "ObjectExpression") {
            expressions.push(body)
          } else if (body.type === "BlockStatement") {
            for (const statement of body.body) {
              if (
                statement.type === "ReturnStatement" &&
                statement.argument?.type === "ObjectExpression"
              ) {
                expressions.push(statement.argument)
              }
            }
          }
        }
      }
      collect(value.expression)
      return expressions
    }

    return {
      JSXOpeningElement(node) {
        for (const attribute of node.attributes) {
          if (
            attribute.type !== "JSXAttribute" ||
            attribute.name.type !== "JSXIdentifier" ||
            (attribute.name.name !== "sx" && attribute.name.name !== "style")
          ) {
            continue
          }
          for (const expression of objectExpressionsFromValue(attribute.value)) {
            checkObject(expression)
          }
        }
      },
    }
  },
}

const consistentBorderRadius = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Enforce the single app-wide corner radius: every borderRadius must be the canonical theme.shape.borderRadius value (1) or 0 for deliberately square corners.",
    },
    messages: {
      wrongRadius:
        'borderRadius must be the app-wide radius (theme.shape.borderRadius, currently {{canonical}}px) or 0 for deliberately square corners; found "{{value}}".',
    },
    schema: [
      {
        type: "object",
        properties: { canonical: { type: "number" } },
        additionalProperties: false,
      },
    ],
  },
  create(context) {
    const canonical = context.options[0]?.canonical ?? 1
    const RADIUS_KEYS = new Set([
      "borderRadius",
      "borderTopLeftRadius",
      "borderTopRightRadius",
      "borderBottomLeftRadius",
      "borderBottomRightRadius",
    ])

    function keyName(key) {
      if (key.type === "Identifier") return key.name
      if (key.type === "Literal" && typeof key.value === "string") {
        return key.value
      }
      return null
    }

    // Anything that is not a literal (member expressions such as
    // theme.shape.borderRadius, identifiers, template literals) is allowed:
    // it either references the canonical token or cannot be judged statically.
    function isAllowedLiteral(value) {
      if (value.type !== "Literal") return true
      const v = value.value
      return (
        v === 0 ||
        v === canonical ||
        v === "0" ||
        v === "0px" ||
        v === String(canonical) ||
        v === `${canonical}px`
      )
    }

    function checkValue(node) {
      if (node.type === "ObjectExpression") {
        // Responsive sx values like { xs: 1, md: 1 } nest literals per
        // breakpoint; every nested value must obey the same policy.
        for (const property of node.properties) {
          if (property.type === "Property" && !property.computed) {
            checkValue(property.value)
          }
        }
        return
      }
      if (!isAllowedLiteral(node)) {
        context.report({
          node,
          messageId: "wrongRadius",
          data: {
            canonical,
            value:
              node.type === "Literal"
                ? String(node.value)
                : context.sourceCode.getText(node).slice(0, 40),
          },
        })
      }
    }

    return {
      Property(node) {
        if (node.computed) return
        const name = keyName(node.key)
        if (name === null || !RADIUS_KEYS.has(name)) return
        checkValue(node.value)
      },
    }
  },
}

export default tseslint.config(
  {
    ignores: [
      "**/.worktrees/**",
      "**/dist/**",
      "**/node_modules/**",
      "**/storybook-static/**",
    ],
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["**/.storybook/**"],
    extends: [js.configs.recommended, ...tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-deprecated": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  {
    files: [".storybook/**/*.{ts,tsx}", "**/.storybook/**/*.{ts,tsx}"],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
  },
  {
    files: ["src/web/**/*.{ts,tsx}"],
    extends: [eslintReact.configs["recommended-typescript"]],
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
      rethinkloop: {
        rules: {
          "accordion-no-outlined-variant": noOutlinedAccordion,
          "no-square-corners": noSquareCorners,
          "no-asymmetric-borders": noAsymmetricBorders,
          "consistent-border-radius": consistentBorderRadius,
        },
      },
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      "rethinkloop/accordion-no-outlined-variant": "error",
      "rethinkloop/no-square-corners": "error",
      "rethinkloop/no-asymmetric-borders": "error",
      "rethinkloop/consistent-border-radius": "error",
    },
  },
  {
    files: ["src/**/*.test.{ts,tsx}"],
    extends: [vitest.configs.recommended],
  },
  {
    files: ["src/web/e2e/**/*.ts"],
    extends: [playwright.configs["flat/recommended"]],
  },
)
