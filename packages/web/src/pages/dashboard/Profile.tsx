import { useEffect, useRef, useState } from "react";
import { Camera, CheckCircle2, Mail, ShieldCheck, Trash2, UserRound } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "../../components/layout/PageHeader";
import { Avatar, AvatarFallback, AvatarImage } from "../../components/ui/avatar";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { useAuth } from "../../hooks/useAuth";
import { useWorkspace } from "../../hooks/useWorkspace";
import { apiErrorMessage } from "../../lib/api-error";
import { prepareProfileImage, type PreparedAvatar } from "../../lib/profile-image";
import { getInitials } from "../../lib/utils";

export function Profile() {
  const { user, updateProfile, uploadAvatar, removeAvatar } = useAuth();
  const { activeStartup } = useWorkspace();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [firstName, setFirstName] = useState(user?.firstName ?? "");
  const [lastName, setLastName] = useState(user?.lastName ?? "");
  // A newly chosen photo, staged locally until Save — not uploaded yet.
  const [pendingPhoto, setPendingPhoto] = useState<PreparedAvatar | null>(null);
  // User clicked Remove; the existing photo goes away on Save.
  const [photoRemoved, setPhotoRemoved] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isProcessingPhoto, setIsProcessingPhoto] = useState(false);

  useEffect(() => {
    setFirstName(user?.firstName ?? "");
    setLastName(user?.lastName ?? "");
    // The server response is the source of truth once it arrives; drop any
    // staged-but-unsaved photo state (and its object URL) rather than let it
    // linger out of sync with what's now persisted.
    setPendingPhoto((prev) => {
      if (prev) URL.revokeObjectURL(prev.previewUrl);
      return null;
    });
    setPhotoRemoved(false);
  }, [user]);

  // Revoke on unmount too, in case the user navigates away mid-edit.
  useEffect(() => {
    return () => {
      if (pendingPhoto) URL.revokeObjectURL(pendingPhoto.previewUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!user) return null;

  const displayName = `${firstName} ${lastName}`.trim() || user.email;
  const avatarSrc = pendingPhoto ? pendingPhoto.previewUrl : photoRemoved ? undefined : (user.avatarUrl ?? undefined);
  const canRemovePhoto = Boolean(pendingPhoto) || (!photoRemoved && Boolean(user.avatarUrl));
  const nameChanged = firstName.trim() !== user.firstName || lastName.trim() !== user.lastName;
  const isDirty = nameChanged || Boolean(pendingPhoto) || photoRemoved;

  async function choosePhoto(file: File | undefined) {
    if (!file) return;
    setIsProcessingPhoto(true);
    try {
      const prepared = await prepareProfileImage(file);
      setPendingPhoto((prev) => {
        if (prev) URL.revokeObjectURL(prev.previewUrl);
        return prepared;
      });
      setPhotoRemoved(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not process that photo");
    } finally {
      setIsProcessingPhoto(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  function removePhoto() {
    setPendingPhoto((prev) => {
      if (prev) URL.revokeObjectURL(prev.previewUrl);
      return null;
    });
    setPhotoRemoved(true);
  }

  async function saveProfile() {
    if (!firstName.trim() || !lastName.trim()) {
      toast.error("First and last name are required");
      return;
    }

    setIsSaving(true);
    try {
      // Sequential, not parallel: both calls end in setUser(fullUserObject),
      // and running them together risks whichever response lands last
      // clobbering the other's field in the client's in-memory user — a
      // transient UI glitch even though both would be correctly persisted.
      if (pendingPhoto) {
        await uploadAvatar(pendingPhoto.blob);
      } else if (photoRemoved) {
        await removeAvatar();
      }
      if (nameChanged) {
        await updateProfile({ firstName: firstName.trim(), lastName: lastName.trim() });
      }
      toast.success("Profile updated");
    } catch (error) {
      toast.error(apiErrorMessage(error, "Could not update your profile"));
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader title="Profile" description="Manage how you appear across your workspace." />

      <section className="relative overflow-hidden rounded-2xl border border-border/70 bg-card shadow-sm">
        <div className="pointer-events-none absolute inset-0 overflow-hidden bg-gradient-to-r from-primary/[0.09] via-primary/[0.04] to-transparent">
          <div className="absolute -right-10 -top-24 h-56 w-56 rounded-full bg-primary/10 blur-3xl" />
          <div className="absolute -bottom-20 left-1/3 h-40 w-40 rounded-full bg-primary/[0.07] blur-3xl" />
        </div>
        <div className="relative flex flex-col gap-5 p-6 sm:flex-row sm:items-center sm:p-8">
          <div className="relative w-fit shrink-0">
            <Avatar className="h-28 w-28 border-4 border-card shadow-xl">
              <AvatarImage src={avatarSrc} alt={displayName} className="object-cover" />
              <AvatarFallback className="bg-primary/15 font-display text-2xl font-semibold text-primary">
                {getInitials(displayName)}
              </AvatarFallback>
            </Avatar>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={(event) => void choosePhoto(event.target.files?.[0])}
            />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="truncate font-display text-2xl font-semibold">{displayName}</h2>
            <p className="mt-1 truncate text-sm text-muted-foreground">{user.email}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {activeStartup && <Badge variant="secondary">{activeStartup.name}</Badge>}
              {activeStartup && <Badge variant="outline" className="capitalize">{activeStartup.member.role}</Badge>}
            </div>
          </div>
          <div className="flex flex-wrap gap-2 sm:ml-auto">
            <Button type="button" variant="outline" onClick={() => fileInputRef.current?.click()} disabled={isProcessingPhoto}>
              <Camera className="mr-2 h-4 w-4" />
              {isProcessingPhoto ? "Processing…" : "Change photo"}
            </Button>
            {canRemovePhoto && (
              <Button type="button" variant="ghost" className="text-destructive" onClick={removePhoto}>
                <Trash2 className="mr-2 h-4 w-4" /> Remove
              </Button>
            )}
          </div>
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_280px]">
        <Card className="border-border/70">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg"><UserRound className="h-5 w-5 text-primary" /> Personal information</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="profile-first-name">First name</Label>
                <Input id="profile-first-name" value={firstName} maxLength={100} onChange={(event) => setFirstName(event.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="profile-last-name">Last name</Label>
                <Input id="profile-last-name" value={lastName} maxLength={100} onChange={(event) => setLastName(event.target.value)} />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="profile-email">Email address</Label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input id="profile-email" value={user.email} readOnly className="bg-muted/30 pl-9 text-muted-foreground" />
              </div>
              <p className="text-xs text-muted-foreground">Your sign-in email cannot be changed here.</p>
            </div>
            <div className="flex justify-end border-t border-border/60 pt-5">
              <Button type="button" disabled={!isDirty || isSaving || isProcessingPhoto} onClick={() => void saveProfile()}>
                {isSaving ? "Saving…" : "Save changes"}
              </Button>
            </div>
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card className="border-border/70 bg-gradient-to-b from-card to-primary/[0.04]">
            <CardContent className="p-5">
              <ShieldCheck className="h-6 w-6 text-primary" />
              <h3 className="mt-4 font-display font-semibold">Account identity</h3>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">Your name and photo are visible to teammates in chat, assignments, and activity.</p>
            </CardContent>
          </Card>
          <div className="flex items-start gap-3 rounded-xl border border-emerald-500/20 bg-emerald-500/[0.06] p-4 text-sm">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
            <div><p className="font-medium">Email verified</p><p className="mt-1 text-xs text-muted-foreground">Your account is ready for team collaboration.</p></div>
          </div>
        </div>
      </div>
    </div>
  );
}
