import { connection } from "next/server";
import { HotelAdminConsole } from "@/components/admin/hotel-admin-console";

export default async function AdminPage() {
  await connection();
  return <HotelAdminConsole />;
}
