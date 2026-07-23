import { Injectable } from '@grensesnitt/grain';
import { SignJWT, jwtVerify } from 'jose';
import type { PublicUser } from '../users/user.service';

export interface JwtPayload {
  sub: string;
  email: string;
}

const encoder = new TextEncoder();

function secretKey(): Uint8Array {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET is not set');
  return encoder.encode(secret);
}

@Injectable()
export class JwtService {
  sign(user: PublicUser): Promise<string> {
    return new SignJWT({ email: user.email })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(String(user.id))
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(secretKey());
  }

  async verify(token: string): Promise<JwtPayload> {
    const { payload } = await jwtVerify(token, secretKey(), {
      algorithms: ['HS256'],
    });
    return { sub: payload.sub as string, email: payload.email as string };
  }
}
