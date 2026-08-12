import ArrowBackRounded from "@mui/icons-material/ArrowBackRounded"
import Box from "@mui/material/Box"
import Button from "@mui/material/Button"
import Link from "@mui/material/Link"
import Paper from "@mui/material/Paper"
import Stack from "@mui/material/Stack"
import Typography from "@mui/material/Typography"
import { useEffect, useRef, type ReactNode } from "react"
import { Link as RouterLink } from "react-router-dom"
import { supportEmail } from "../lib/support.ts"

const lastUpdated = "12 August 2026"

function SupportLink() {
  return (
    <Link href={`mailto:${supportEmail}`}>{supportEmail}</Link>
  )
}

function LegalList({ children }: { children: ReactNode }) {
  return (
    <Box component="ul" sx={{ m: 0, pl: 3 }}>
      {children}
    </Box>
  )
}

function LegalListItem({ children }: { children: ReactNode }) {
  return (
    <Typography component="li" sx={{ mb: 1 }}>
      {children}
    </Typography>
  )
}

function LegalSection({
  children,
  title,
}: {
  children: ReactNode
  title: string
}) {
  return (
    <Stack component="section" spacing={1.5}>
      <Typography component="h2" variant="h5">
        {title}
      </Typography>
      {children}
    </Stack>
  )
}

function LegalDocument({
  children,
  introduction,
  title,
}: {
  children: ReactNode
  introduction: string
  title: string
}) {
  const headingRef = useRef<HTMLHeadingElement>(null)

  useEffect(() => {
    window.scrollTo({ behavior: "auto", left: 0, top: 0 })
    headingRef.current?.focus({ preventScroll: true })
  }, [])

  return (
    <Stack
      component="article"
      spacing={4}
      sx={{ maxWidth: "72ch", py: { xs: 6, md: 10 } }}
    >
      <Stack spacing={1.5}>
        <Typography color="primary.main" variant="overline">
          Legal
        </Typography>
        <Typography
          component="h1"
          ref={headingRef}
          sx={{ outline: "none" }}
          tabIndex={-1}
          variant="h3"
        >
          {title}
        </Typography>
        <Typography color="text.secondary">Last updated: {lastUpdated}</Typography>
        <Typography>{introduction}</Typography>
      </Stack>

      {children}

      <Button
        component={RouterLink}
        startIcon={<ArrowBackRounded />}
        sx={{ alignSelf: "flex-start" }}
        to="/"
        variant="outlined"
      >
        Back to home
      </Button>
    </Stack>
  )
}

export function TermsAndConditions() {
  return (
    <LegalDocument
      introduction="These terms govern your access to and use of RethinkLoop. By using the service, you agree to them. If you do not agree, do not use the service."
      title="Terms & Conditions"
    >
      <LegalSection title="The service">
        <Typography>
          RethinkLoop provides AI-assisted research, idea generation, and
          structured debate tools. Features may change, be suspended, or be
          discontinued, and the service may occasionally be unavailable.
        </Typography>
      </LegalSection>

      <LegalSection title="Accounts">
        <Typography>
          You are responsible for activity under your account and for keeping
          access to your sign-in provider secure. Give us accurate account
          information and contact support promptly if you believe your account
          has been compromised.
        </Typography>
      </LegalSection>

      <Paper sx={{ p: { xs: 2.5, sm: 3.5 } }} variant="outlined">
        <LegalSection title="AI output can be wrong">
          <Typography>
            AI-generated research, summaries, ideas, arguments, rankings, and
            conclusions may be inaccurate, incomplete, biased, misleading, or
            outdated. A linked source does not guarantee that the output
            represents that source correctly.
          </Typography>
          <Typography>
            Verify important claims against reliable primary sources and use
            qualified professionals for legal, medical, financial, safety, or
            other high-impact decisions. You are responsible for deciding
            whether and how to rely on any output.
          </Typography>
        </LegalSection>
      </Paper>

      <LegalSection title="Your content">
        <Typography>
          You retain any rights you have in prompts and other material you
          submit. You give RethinkLoop permission to host, reproduce, process,
          and transmit that material only as needed to operate, secure, and
          support the service. Do not submit material you lack the right to use
          or information you are not authorised to share with external service
          providers.
        </Typography>
        <Typography>
          Content you deliberately publish or share through a public feature
          may be viewed and copied by other people. Remove it from public view
          before sharing anything you want to keep private.
        </Typography>
      </LegalSection>

      <LegalSection title="Acceptable use">
        <Typography>Do not use RethinkLoop to:</Typography>
        <LegalList>
          <LegalListItem>
            break the law, violate another person&apos;s rights, or facilitate
            fraud or abuse;
          </LegalListItem>
          <LegalListItem>
            access accounts, data, or systems without permission;
          </LegalListItem>
          <LegalListItem>
            disrupt, overload, scrape, reverse engineer, or bypass safeguards
            or usage restrictions on the service; or
          </LegalListItem>
          <LegalListItem>
            present AI-generated content as verified fact when doing so could
            foreseeably harm someone.
          </LegalListItem>
        </LegalList>
      </LegalSection>

      <LegalSection title="Our materials">
        <Typography>
          RethinkLoop and its software, design, branding, and documentation are
          protected by intellectual property laws. These terms allow you to use
          the service; they do not transfer ownership of those materials.
        </Typography>
      </LegalSection>

      <LegalSection title="Suspension and termination">
        <Typography>
          You may stop using the service at any time. We may restrict or end
          access when reasonably necessary to protect the service or its users,
          respond to legal requirements, or address a material breach of these
          terms.
        </Typography>
      </LegalSection>

      <LegalSection title="Disclaimers and liability">
        <Typography>
          The service is provided on an “as is” and “as available” basis. To the
          fullest extent permitted by law, RethinkLoop disclaims implied
          warranties and is not liable for indirect, incidental, special,
          consequential, or punitive losses arising from use of the service.
          Nothing in these terms excludes liability that cannot legally be
          excluded.
        </Typography>
      </LegalSection>

      <LegalSection title="Changes to these terms">
        <Typography>
          We may update these terms as the service changes. We will post the
          revised terms here and update the date above. Continuing to use the
          service after an update means you accept the revised terms.
        </Typography>
      </LegalSection>

      <LegalSection title="Contact">
        <Typography>
          Questions about these terms or the service can be sent to{" "}
          <SupportLink />.
        </Typography>
      </LegalSection>
    </LegalDocument>
  )
}

export function PrivacyPolicy() {
  return (
    <LegalDocument
      introduction="This policy explains what information RethinkLoop collects, why it is used, where it may be sent, and the choices available to you."
      title="Privacy Policy"
    >
      <LegalSection title="Information we collect">
        <LegalList>
          <LegalListItem>
            <strong>Account information:</strong> your GitHub account
            identifier, name, email address, avatar, and authentication records.
          </LegalListItem>
          <LegalListItem>
            <strong>Content:</strong> prompts, selected sources, research jobs,
            generated outputs, debates, sharing choices, and related workflow
            data.
          </LegalListItem>
          <LegalListItem>
            <strong>Technical information:</strong> session identifiers, IP
            address, browser or device information, request details, and
            timestamps used to operate and secure the service.
          </LegalListItem>
          <LegalListItem>
            <strong>Support communications:</strong> messages and contact
            details you send when requesting help.
          </LegalListItem>
        </LegalList>
      </LegalSection>

      <LegalSection title="How we use information">
        <Typography>We use this information to:</Typography>
        <LegalList>
          <LegalListItem>authenticate users and maintain accounts;</LegalListItem>
          <LegalListItem>
            run, save, display, and share workflows as you direct;
          </LegalListItem>
          <LegalListItem>
            prevent abuse, diagnose failures, and keep the service secure; and
          </LegalListItem>
          <LegalListItem>
            respond to support requests and meet legal obligations.
          </LegalListItem>
        </LegalList>
      </LegalSection>

      <LegalSection title="Service providers and data sharing">
        <Typography>
          RethinkLoop sends data to service providers only as needed to provide
          the service. Depending on the deployed configuration and feature you
          use, these providers include GitHub for sign-in, an external AI model
          provider for generation, search services for finding sources, and a
          page-retrieval provider for reading selected web pages. Prompts,
          relevant workflow context, search queries, and page URLs or content
          may be sent to those providers.
        </Typography>
        <Typography>
          We may also disclose information when required by law, to protect the
          rights and security of users or the service, or as part of a business
          transfer. We do not sell personal information or share it for
          behavioural advertising.
        </Typography>
      </LegalSection>

      <Paper sx={{ p: { xs: 2.5, sm: 3.5 } }} variant="outlined">
        <LegalSection title="Cookies and analytics">
          <Typography>
            RethinkLoop currently uses only strictly necessary authentication
            and session cookies. These cookies support sign-in, maintain your
            session, and protect account access. Blocking them may prevent
            signed-in features from working.
          </Typography>
          <Typography>
            We do not currently use non-essential cookies, advertising cookies,
            or analytics trackers, so no cookie consent banner is shown. If
            that changes, we will update this policy and request consent where
            required before activating non-essential tracking.
          </Typography>
        </LegalSection>
      </Paper>

      <LegalSection title="Retention">
        <Typography>
          Account, session, and workflow data is retained for as long as needed
          to provide and secure the service, resolve disputes, and meet legal
          obligations. You can request account or content deletion by contacting
          support. Some records may remain in backups or where retention is
          legally required.
        </Typography>
      </LegalSection>

      <LegalSection title="Security and international processing">
        <Typography>
          We use reasonable technical and organisational measures to protect
          information, but no online service is completely secure. RethinkLoop
          and its providers may process information in countries other than
          yours, where privacy laws may differ.
        </Typography>
      </LegalSection>

      <LegalSection title="Your choices and rights">
        <Typography>
          You can choose what prompts to submit and what content to publish.
          Depending on where you live, you may also have rights to access,
          correct, delete, restrict, object to, or receive a copy of personal
          information. Contact us to make a request. We may need to verify your
          identity first.
        </Typography>
      </LegalSection>

      <LegalSection title="Children">
        <Typography>
          RethinkLoop is not directed to children, and we do not knowingly
          collect personal information from children. Contact us if you believe
          a child has provided personal information.
        </Typography>
      </LegalSection>

      <LegalSection title="Changes to this policy">
        <Typography>
          We may update this policy as the service or its data practices change.
          We will post the revised policy here and update the date above.
        </Typography>
      </LegalSection>

      <LegalSection title="Contact">
        <Typography>
          Privacy questions and requests can be sent to <SupportLink />.
        </Typography>
      </LegalSection>
    </LegalDocument>
  )
}
