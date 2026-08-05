import {
  createTheme,
  enhanceHighContrast,
} from "@mui/material/styles"

function withAlpha(color: string, opacity: number): string {
  return `color-mix(in srgb, ${color} ${opacity * 100}%, transparent)`
}

const darkTheme = createTheme({
  cssVariables: true,
  palette: {
    mode: "dark",
    primary: {
      main: "#8AB4F8",
      light: "#A9C8FA",
      dark: "#6594DD",
      contrastText: "#09111F",
    },
    secondary: {
      main: "#B7A7E8",
      light: "#CFC3F0",
      dark: "#9382C8",
      contrastText: "#110E1B",
    },
    success: {
      main: "#72C991",
      light: "#91D8A9",
      dark: "#4FAE70",
      contrastText: "#07150D",
    },
    warning: {
      main: "#DDB36A",
      light: "#E8C98F",
      dark: "#BD914A",
      contrastText: "#181004",
    },
    error: {
      main: "#EF7B82",
      light: "#F39BA0",
      dark: "#D65C65",
      contrastText: "#1D0709",
    },
    info: {
      main: "#76B9DB",
      light: "#98CCE5",
      dark: "#5298BC",
      contrastText: "#071318",
    },
    background: {
      default: "#0B0D10",
      paper: "#111419",
    },
    text: {
      primary: "#F1F3F5",
      secondary: "#A0A7B2",
      disabled: "#666D78",
    },
    divider: "rgba(255, 255, 255, 0.10)",
    action: {
      active: "#C4CAD3",
      hover: "rgba(255, 255, 255, 0.055)",
      selected: "rgba(138, 180, 248, 0.11)",
      disabled: "rgba(255, 255, 255, 0.36)",
      disabledBackground: "rgba(255, 255, 255, 0.075)",
      focus: "rgba(138, 180, 248, 0.18)",
    },
  },
  shape: {
    borderRadius: 10,
  },
  typography: {
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Helvetica, Arial, sans-serif',
    fontSize: 14,
    h4: {
      fontSize: "1.75rem",
      fontWeight: 650,
      letterSpacing: "-0.025em",
      lineHeight: 1.2,
    },
    h5: {
      fontSize: "1.25rem",
      fontWeight: 650,
      letterSpacing: "-0.015em",
      lineHeight: 1.3,
    },
    h6: {
      fontSize: "1.0625rem",
      fontWeight: 650,
      letterSpacing: "-0.01em",
      lineHeight: 1.4,
    },
    subtitle1: {
      fontSize: "0.9375rem",
      fontWeight: 650,
      lineHeight: 1.45,
    },
    subtitle2: {
      fontSize: "0.8125rem",
      fontWeight: 650,
      lineHeight: 1.45,
    },
    body1: {
      fontSize: "0.9375rem",
      lineHeight: 1.6,
    },
    body2: {
      fontSize: "0.875rem",
      lineHeight: 1.6,
    },
    button: {
      fontSize: "0.8125rem",
      fontWeight: 650,
      letterSpacing: "-0.005em",
      textTransform: "none",
    },
    overline: {
      fontSize: "0.6875rem",
      fontWeight: 650,
      letterSpacing: "0.08em",
      lineHeight: 1.6,
      textTransform: "uppercase",
    },
    caption: {
      fontSize: "0.75rem",
      lineHeight: 1.5,
    },
  },
  components: {
    MuiCssBaseline: {
      styleOverrides: (theme) => ({
        ":root": {
          backgroundColor: theme.vars.palette.background.default,
          colorScheme: "dark",
        },
        body: {
          minWidth: 320,
        },
        "::selection": {
          backgroundColor: withAlpha(theme.vars.palette.primary.main, 0.28),
        },
        "@media (prefers-reduced-motion: reduce)": {
          // MUI transitions may set inline durations, so the user preference
          // needs enough priority to override every component consistently.
          "*, *::before, *::after": {
            animationDuration: "0.01ms !important",
            animationIterationCount: "1 !important",
            scrollBehavior: "auto !important",
            transitionDuration: "0.01ms !important",
          },
        },
      }),
    },
    MuiButtonBase: {
      defaultProps: {
        disableRipple: true,
      },
      styleOverrides: {
        root: ({ theme }) => ({
          "&.Mui-focusVisible": {
            outline: `2px solid ${theme.vars.palette.primary.main}`,
            outlineOffset: 2,
          },
        }),
      },
    },
    MuiButton: {
      defaultProps: {
        disableElevation: true,
      },
      styleOverrides: {
        root: {
          borderRadius: 8,
          minHeight: 38,
          paddingInline: 14,
          textTransform: "none",
        },
        sizeSmall: {
          minHeight: 32,
          paddingInline: 10,
        },
        contained: {
          boxShadow: "none",
          "&:hover": {
            boxShadow: "none",
          },
        },
        outlined: ({ theme }) => ({
          borderColor: theme.vars.palette.divider,
          "&:hover": {
            backgroundColor: theme.vars.palette.action.hover,
            borderColor: theme.vars.palette.primary.main,
          },
        }),
        text: {
          paddingInline: 10,
        },
      },
    },
    MuiOutlinedInput: {
      styleOverrides: {
        root: ({ theme }) => ({
          backgroundColor: withAlpha(theme.vars.palette.common.white, 0.025),
          borderRadius: 8,
          minHeight: 40,
          transition: theme.transitions.create(
            ["background-color", "box-shadow"],
            { duration: theme.transitions.duration.shorter },
          ),
          "& .MuiOutlinedInput-notchedOutline": {
            borderColor: theme.vars.palette.divider,
          },
          "&:hover .MuiOutlinedInput-notchedOutline": {
            borderColor: withAlpha(theme.vars.palette.common.white, 0.24),
          },
          "&.Mui-focused": {
            boxShadow: `0 0 0 3px ${withAlpha(theme.vars.palette.primary.main, 0.16)}`,
          },
          "&.Mui-error": {
            boxShadow: `0 0 0 3px ${withAlpha(theme.vars.palette.error.main, 0.13)}`,
          },
          "&.Mui-disabled": {
            backgroundColor: theme.vars.palette.action.disabledBackground,
          },
        }),
        input: {
          padding: "10px 12px",
        },
      },
    },
    MuiInputLabel: {
      styleOverrides: {
        root: {
          fontSize: "0.875rem",
        },
      },
    },
    MuiFormHelperText: {
      styleOverrides: {
        root: {
          marginInline: 0,
        },
      },
    },
    MuiPaper: {
      styleOverrides: {
        root: {
          backgroundImage: "none",
        },
        outlined: ({ theme }) => ({
          borderColor: theme.vars.palette.divider,
        }),
      },
    },
    MuiCard: {
      defaultProps: {
        variant: "outlined",
      },
      styleOverrides: {
        root: ({ theme }) => ({
          backgroundColor: theme.vars.palette.background.paper,
          borderColor: theme.vars.palette.divider,
          borderRadius: 12,
          boxShadow: "none",
        }),
      },
    },
    MuiCardContent: {
      styleOverrides: {
        root: ({ theme }) => ({
          padding: 20,
          "&:last-child": {
            paddingBottom: 20,
          },
          [theme.breakpoints.down("sm")]: {
            padding: 16,
            "&:last-child": {
              paddingBottom: 16,
            },
          },
        }),
      },
    },
    MuiCardActionArea: {
      styleOverrides: {
        root: ({ theme }) => ({
          "&.Mui-focusVisible": {
            boxShadow: `inset 0 0 0 2px ${theme.vars.palette.primary.main}`,
            outline: 0,
          },
        }),
      },
    },
    MuiAppBar: {
      defaultProps: {
        color: "transparent",
        elevation: 0,
      },
      styleOverrides: {
        root: ({ theme }) => ({
          backgroundColor: withAlpha(
            theme.vars.palette.background.default,
            0.94,
          ),
          backgroundImage: "none",
          borderBottom: `1px solid ${theme.vars.palette.divider}`,
          boxShadow: "none",
          color: theme.vars.palette.text.primary,
        }),
      },
    },
    MuiAccordion: {
      defaultProps: {
        disableGutters: true,
        elevation: 0,
      },
      styleOverrides: {
        root: ({ theme }) => ({
          backgroundColor: theme.vars.palette.background.paper,
          backgroundImage: "none",
          boxShadow: "none",
          "&::before": {
            backgroundColor: theme.vars.palette.divider,
          },
          "&.Mui-expanded": {
            margin: 0,
          },
        }),
      },
    },
    MuiAccordionSummary: {
      styleOverrides: {
        root: {
          minHeight: 48,
          "&.Mui-expanded": {
            minHeight: 48,
          },
        },
        content: {
          marginBlock: 12,
          "&.Mui-expanded": {
            marginBlock: 12,
          },
        },
      },
    },
    MuiAccordionDetails: {
      styleOverrides: {
        root: {
          padding: "0 16px 16px",
        },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: {
          borderRadius: 6,
          fontSize: "0.75rem",
          fontWeight: 650,
          height: 28,
        },
        sizeSmall: {
          height: 24,
        },
        outlined: ({ theme }) => ({
          borderColor: theme.vars.palette.divider,
        }),
      },
    },
    MuiAlert: {
      styleOverrides: {
        root: ({ theme }) => ({
          alignItems: "center",
          border: `1px solid ${theme.vars.palette.divider}`,
          borderRadius: 10,
        }),
      },
    },
    MuiListItemButton: {
      styleOverrides: {
        root: ({ theme }) => ({
          gap: 12,
          padding: "12px 16px",
          transition: theme.transitions.create(
            ["background-color", "border-color"],
            { duration: theme.transitions.duration.shorter },
          ),
          "&.Mui-selected": {
            backgroundColor: theme.vars.palette.action.selected,
          },
          "&.Mui-selected:hover": {
            backgroundColor: withAlpha(
              theme.vars.palette.primary.main,
              0.15,
            ),
          },
        }),
      },
    },
    MuiTableCell: {
      styleOverrides: {
        root: ({ theme }) => ({
          borderColor: theme.vars.palette.divider,
          padding: "10px 12px",
        }),
        head: ({ theme }) => ({
          backgroundColor: theme.vars.palette.background.paper,
          color: theme.vars.palette.text.secondary,
          fontSize: "0.75rem",
          fontWeight: 650,
        }),
        sizeSmall: {
          padding: "8px 10px",
        },
      },
    },
    MuiDivider: {
      styleOverrides: {
        root: ({ theme }) => ({
          borderColor: theme.vars.palette.divider,
        }),
      },
    },
    MuiLinearProgress: {
      styleOverrides: {
        root: ({ theme }) => ({
          backgroundColor: theme.vars.palette.action.selected,
          borderRadius: 999,
          height: 6,
        }),
        bar: {
          borderRadius: 999,
        },
      },
    },
    MuiLink: {
      styleOverrides: {
        root: {
          fontWeight: 550,
          textDecorationColor: "currentColor",
          textUnderlineOffset: 3,
        },
      },
    },
  },
})

export const appTheme = enhanceHighContrast(darkTheme)
