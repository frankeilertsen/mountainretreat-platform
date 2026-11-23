'use server';
import { run, str, int } from '@/lib/actions';
import { clientIp } from '@/lib/auth/current';
import { submitLongTermInquiry } from '@/lib/domain/inquiries';

export async function longTermInquiryAction(f: FormData) {
  const ip = await clientIp();
  await run('/fast-leie', async () => {
    await submitLongTermInquiry({
      name: str(f, 'name'), email: str(f, 'email'), phone: str(f, 'phone'), propertyId: str(f, 'propertyId') || null,
      moveIn: str(f, 'moveIn') || null, duration: str(f, 'duration'), persons: int(f, 'persons') || null,
      message: str(f, 'message'), consent: !!f.get('consent'), website: str(f, 'website'),
    }, ip);
    return { redirect: '/fast-leie?sendt=1' };
  });
}
