import { Suspense } from "react";
import { FrontdeskConsole } from "@/components/frontdesk/frontdesk-console";

export default function Home() {
  return (
    <Suspense>
      <FrontdeskConsole />
    </Suspense>
  );
}
