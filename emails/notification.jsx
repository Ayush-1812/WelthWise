import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Html,
  Preview,
  Section,
  Text,
} from "@react-email/components";

/**
 * Split Expenses notification email (M16).
 *
 * Deliberately separate from emails/template.jsx, which is a two-branch
 * switch for the monthly report and budget alert. Adding a third branch there
 * would have meant every notification re-rendering that whole component.
 */
export default function NotificationEmail({
  userName = "there",
  title = "You have a new notification",
  body = null,
  linkUrl = "/split",
  appUrl = process.env.NEXT_PUBLIC_APP_URL || "",
}) {
  const href = appUrl ? `${appUrl}${linkUrl}` : null;

  return (
    <Html>
      <Head />
      <Preview>{title}</Preview>
      <Body style={styles.body}>
        <Container style={styles.container}>
          <Heading style={styles.title}>{title}</Heading>

          <Text style={styles.text}>Hi {userName || "there"},</Text>

          {body && <Text style={styles.text}>{body}</Text>}

          {href && (
            <Section style={styles.buttonWrap}>
              <Button style={styles.button} href={href}>
                Open in WealthWise
              </Button>
            </Section>
          )}

          <Text style={styles.footer}>
            You are receiving this because of shared-expense activity in
            WealthWise.
          </Text>
        </Container>
      </Body>
    </Html>
  );
}

const styles = {
  body: {
    backgroundColor: "#f6f9fc",
    fontFamily: "-apple-system, system-ui, BlinkMacSystemFont, sans-serif",
  },
  container: {
    backgroundColor: "#ffffff",
    margin: "0 auto",
    padding: "24px",
    borderRadius: "8px",
    maxWidth: "520px",
  },
  title: {
    color: "#1f2937",
    fontSize: "20px",
    lineHeight: "28px",
    margin: "0 0 16px",
  },
  text: {
    color: "#4b5563",
    fontSize: "15px",
    lineHeight: "22px",
    margin: "0 0 12px",
  },
  buttonWrap: { margin: "20px 0" },
  button: {
    backgroundColor: "#9333ea",
    color: "#ffffff",
    borderRadius: "6px",
    padding: "10px 18px",
    fontSize: "14px",
    fontWeight: 600,
    textDecoration: "none",
  },
  footer: {
    color: "#9ca3af",
    fontSize: "12px",
    lineHeight: "18px",
    margin: "20px 0 0",
  },
};
