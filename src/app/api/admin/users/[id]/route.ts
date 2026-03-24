import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getUserById, updateUserRole, updateUserStatus } from "@/db/queries";
import { denyUnauth, denyForbidden, isAdmin, canModifyAdmin, isSystemUser } from "@/server/permissions";
import { logAudit } from "@/server/audit";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const actor = await getCurrentUser();
    if (!actor) return denyUnauth();
    if (!isAdmin(actor)) return denyForbidden();

    const { id } = await params;

    if (isSystemUser(id)) {
      return NextResponse.json(
        { error: "Cannot modify system user" },
        { status: 403 },
      );
    }

    const target = getUserById(id);
    if (!target) {
      return NextResponse.json(
        { error: "User not found" },
        { status: 404 },
      );
    }

    const body = await request.json();

    // Handle role change
    if (body.role && body.role !== target.role) {
      if (body.role !== "admin" && body.role !== "user") {
        return NextResponse.json(
          { error: "Invalid role" },
          { status: 400 },
        );
      }

      // If demoting an admin, check last-admin protection
      if (target.role === "admin" && body.role === "user") {
        if (!canModifyAdmin(id)) {
          return NextResponse.json(
            { error: "Cannot demote the last active admin" },
            { status: 409 },
          );
        }
      }

      updateUserRole(id, body.role);
      logAudit("user.role_change", actor.id, "user", id, {
        old_role: target.role,
        new_role: body.role,
      });
    }

    // Handle status change (ban/unban)
    if (body.status && body.status !== target.status) {
      if (body.status !== "active" && body.status !== "banned") {
        return NextResponse.json(
          { error: "Invalid status" },
          { status: 400 },
        );
      }

      // If banning an admin, check last-admin protection
      if (body.status === "banned" && target.role === "admin") {
        if (!canModifyAdmin(id)) {
          return NextResponse.json(
            { error: "Cannot ban the last active admin" },
            { status: 409 },
          );
        }
      }

      updateUserStatus(id, body.status);
      const action = body.status === "banned" ? "user.ban" : "user.unban";
      logAudit(action, actor.id, "user", id, {
        reason: body.reason || "",
      });
    }

    const updated = getUserById(id);
    return NextResponse.json({ user: updated });
  } catch (error) {
    console.error("Admin update user error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
