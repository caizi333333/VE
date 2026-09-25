import { notFound } from "next/navigation";
import CoursewareStudio from "@/components/CoursewareStudio";
import { COURSEWARE, type CoursewareSlug } from "@/lib/courseware";

export function generateStaticParams() { return COURSEWARE.map(item => ({ unit: item.slug })); }
export default async function CoursewarePage({ params }: { params: Promise<{ unit: string }> }) {
  const { unit } = await params;
  if (!COURSEWARE.some(item => item.slug === unit)) notFound();
  return <CoursewareStudio unit={unit as CoursewareSlug} />;
}
