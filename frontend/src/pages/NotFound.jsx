import { ArrowLeft, Compass } from "lucide-react";
import { Link } from "react-router-dom";
import { Button, EmptyState, GlassCard } from "../components/ui";

export function NotFound() {
  return (
    <GlassCard className="not-found">
      <EmptyState
        icon={Compass}
        title="This page wandered off"
        description="The page you're looking for doesn't exist or has moved."
        action={<Link to="/"><Button icon={ArrowLeft}>Back to overview</Button></Link>}
      />
    </GlassCard>
  );
}
