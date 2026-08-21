import Box from "@mui/material/Box";
import Container from "@mui/material/Container";
import Link from "@mui/material/Link";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { Link as RouterLink } from "react-router-dom";
import { supportEmail } from "../../lib/support.ts";

export function AppFooter() {
  return (
    <Box
      component="footer"
      sx={{ borderTop: 1, borderColor: "divider", mt: "auto" }}
    >
      <Container maxWidth="lg" sx={{ py: 3 }}>
        <Stack spacing={2.5}>
          <Stack
            direction={{ xs: "column", sm: "row" }}
            spacing={2}
            sx={{
              alignItems: { sm: "center" },
              justifyContent: "space-between",
            }}
          >
            <Stack spacing={0.5}>
              <Typography component="p" variant="subtitle2">
                RethinkLoop
              </Typography>
              <Typography color="text.secondary" variant="caption">
                Better ideas through debate.
              </Typography>
            </Stack>
            <Stack
              aria-label="Legal and support"
              component="nav"
              direction="row"
              spacing={2.5}
              sx={{ flexWrap: "wrap", rowGap: 1 }}
            >
              <Link color="text.secondary" component={RouterLink} to="/terms">
                Terms &amp; Conditions
              </Link>
              <Link color="text.secondary" component={RouterLink} to="/privacy">
                Privacy Policy
              </Link>
              <Link color="text.secondary" href={`mailto:${supportEmail}`}>
                Contact support
              </Link>
            </Stack>
          </Stack>
        </Stack>
      </Container>
    </Box>
  );
}
