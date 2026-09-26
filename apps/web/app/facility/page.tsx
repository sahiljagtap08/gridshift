import { FacilityView } from "@/components/facility/FacilityView";

export const metadata = { title: "Facility · GridShift" };

export default function FacilityPage() {
  return (
    <div className="h-[calc(100vh-7.5rem)] min-h-[520px]">
      <FacilityView backHref="/live-ops" />
    </div>
  );
}
