import { EmptyState } from "@/components/layout/empty-state";
import { PageSkeleton } from "@/components/layout/page-skeleton";

type PageStubProps = {
  title: string;
  description: string;
  children?: React.ReactNode;
};

export function PageStub({ title, description, children }: PageStubProps) {
  return (
    <section className="space-y-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="text-sm text-muted-foreground">{description}</p>
      </header>

      {children ? <div>{children}</div> : null}

      <PageSkeleton />

      <EmptyState
        title={`Раздел «${title}» пока не реализован`}
        description="Это временная страница-заглушка."
      />
    </section>
  );
}
