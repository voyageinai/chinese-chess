import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { deleteInviteCode } from "@/db/queries";
import { denyUnauth, denyForbidden, isAdmin } from "@/server/permissions";
import { logAudit } from "@/server/audit";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ code: string }> },
) {
  try {
    const user = await getCurrentUser();
    if (!user) return denyUnauth();
    if (!isAdmin(user)) return denyForbidden();

    const { code } = await params;
    const deleted = deleteInviteCode(code);

    if (!deleted) {
      return NextResponse.json(
        { error: "Invite code not found or already used" },
        { status: 404 },
      );
    }

    logAudit("invite.revoke", user.id, null, null, {
      code_prefix: code.substring(0, 8),
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Admin delete invite error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
