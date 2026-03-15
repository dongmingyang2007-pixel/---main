"use client";

import { Link, useRouter } from "@/i18n/navigation";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

import { PageTransition } from "@/components/console/PageTransition";
import { PanelLayout } from "@/components/console/PanelLayout";
import { apiGet, apiPatch, apiDelete } from "@/lib/api";
import { useProjectContext } from "@/lib/ProjectContext";
import { useToast } from "@/hooks/use-toast";

export default function ProjectDetailPage() {
  const params = useParams<{ id: string }>();
  const projectId = Array.isArray(params.id) ? params.id[0] : params.id;
  const router = useRouter();
  const { loadProjects } = useProjectContext();
  const { toast } = useToast();
  const t = useTranslations("console-projects");

  const [project, setProject] = useState<{ id: string; name: string; description?: string } | null>(null);
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!projectId) return;
    void apiGet<{ id: string; name: string; description?: string }>(`/api/v1/projects/${projectId}`).then(setProject);
  }, [projectId]);

  const startEditing = () => {
    if (!project) return;
    setEditName(project.name);
    setEditDesc(project.description || "");
    setEditing(true);
  };

  const cancelEditing = () => {
    setEditing(false);
  };

  const saveChanges = async () => {
    if (!project || !editName.trim()) return;
    setSaving(true);
    try {
      const updated = await apiPatch<{ id: string; name: string; description?: string }>(
        `/api/v1/projects/${project.id}`,
        { name: editName.trim(), description: editDesc.trim() || null },
      );
      setProject(updated);
      setEditing(false);
      await loadProjects();
      toast({ title: t("detail.saveButton"), description: editName.trim() });
    } catch (err) {
      toast({ title: "Error", description: err instanceof Error ? err.message : "Failed", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!project) return;
    const confirmed = window.confirm(t("detail.deleteConfirm", { name: project.name }));
    if (!confirmed) return;
    setDeleting(true);
    try {
      await apiDelete(`/api/v1/projects/${project.id}`);
      await loadProjects();
      toast({ title: t("detail.deleteButton"), description: project.name });
      router.push("/app/projects");
    } catch (err) {
      toast({ title: "Error", description: err instanceof Error ? err.message : "Failed", variant: "destructive" });
      setDeleting(false);
    }
  };

  if (!project) {
    return <PanelLayout><div className="console-panel"><div className="console-panel-body">{t("loading")}</div></div></PanelLayout>;
  }

  const QUICK_LINKS = [
    { href: "/app/datasets", label: t("detail.link.datasets"), desc: t("detail.link.datasetsDesc") },
    { href: "/app/train", label: t("detail.link.train"), desc: t("detail.link.trainDesc") },
    { href: "/app/models", label: t("detail.link.models"), desc: t("detail.link.modelsDesc") },
    { href: "/app/eval", label: t("detail.link.eval"), desc: t("detail.link.evalDesc") },
  ];

  return (
    <PanelLayout>
      <PageTransition>
        <div className="p-6 space-y-6">
          <div>
            <p className="text-xs font-semibold tracking-widest text-[var(--text-secondary)] uppercase">
              {t("detail.kicker")}
            </p>
            <h1 className="mt-2 text-2xl font-bold">{t("detail.title")}</h1>
            <p className="mt-1 text-sm text-[var(--text-secondary)]">{t("detail.description")}</p>
          </div>

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
            <section className="console-panel">
              <div className="console-panel-header">
                <div className="flex-1">
                  {editing ? (
                    <div className="space-y-3">
                      <div>
                        <label className="console-label" htmlFor="edit-name">{t("detail.nameLabel")}</label>
                        <input
                          id="edit-name"
                          className="console-input"
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                        />
                      </div>
                      <div>
                        <label className="console-label" htmlFor="edit-desc">{t("detail.descriptionLabel")}</label>
                        <input
                          id="edit-desc"
                          className="console-input"
                          value={editDesc}
                          onChange={(e) => setEditDesc(e.target.value)}
                          placeholder={t("detail.descriptionPlaceholder")}
                        />
                      </div>
                      <div className="flex gap-2">
                        <button className="console-button" onClick={saveChanges} disabled={saving || !editName.trim()}>
                          {saving ? t("detail.saving") : t("detail.saveButton")}
                        </button>
                        <button className="console-button-secondary" onClick={cancelEditing} disabled={saving}>
                          {t("detail.cancelButton")}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <h2 className="console-panel-title">{project.name}</h2>
                          <p className="console-panel-description">{project.description || t("detail.noDescription")}</p>
                        </div>
                        <button className="console-button-secondary shrink-0" onClick={startEditing}>
                          {t("detail.editButton")}
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </div>
              <div className="console-panel-body">
                <div className="console-key-grid">
                  {QUICK_LINKS.map((link) => (
                    <Link key={link.href} className="console-key-item" href={link.href}>
                      <div className="console-key-label">{link.label}</div>
                      <div className="console-key-value">{link.desc}</div>
                    </Link>
                  ))}
                </div>
              </div>
            </section>

            <div className="space-y-4">
              <aside className="console-panel">
                <div className="console-panel-body">
                  <div className="console-kicker">{t("detail.projectId")}</div>
                  <div className="console-code mt-4">{project.id}</div>
                </div>
              </aside>

              <aside className="console-panel">
                <div className="console-panel-body">
                  <button
                    className="console-button-danger w-full"
                    onClick={handleDelete}
                    disabled={deleting}
                  >
                    {deleting ? t("detail.deleting") : t("detail.deleteButton")}
                  </button>
                </div>
              </aside>
            </div>
          </div>
        </div>
      </PageTransition>
    </PanelLayout>
  );
}
