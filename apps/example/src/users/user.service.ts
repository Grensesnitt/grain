import { Injectable, NotFoundError } from '@grensesnitt/grain';
import { UserRepository, type User } from './user.repository';

export interface PublicUser {
  id: number;
  name: string;
  email: string;
}

export interface CreateUserData {
  name: string;
  email: string;
  password: string;
}

function toPublic(user: User): PublicUser {
  return { id: user.id, name: user.name, email: user.email };
}

@Injectable()
export class UserService {
  constructor(private readonly repo: UserRepository) {}

  list(): PublicUser[] {
    return this.repo.list().map(toPublic);
  }

  find(id: number): PublicUser {
    const user = this.repo.find(id);
    if (!user) throw new NotFoundError(`user ${id} not found`);
    return toPublic(user);
  }

  async create(data: CreateUserData): Promise<PublicUser> {
    const passwordHash = await Bun.password.hash(data.password);
    return toPublic(
      this.repo.insert({ name: data.name, email: data.email, passwordHash })
    );
  }

  async verifyCredentials(
    email: string,
    password: string
  ): Promise<PublicUser | null> {
    const user = this.repo.findByEmail(email);
    if (!user) return null;
    const valid = await Bun.password.verify(password, user.passwordHash);
    return valid ? toPublic(user) : null;
  }

  remove(id: number): void {
    if (!this.repo.delete(id)) throw new NotFoundError(`user ${id} not found`);
  }
}
