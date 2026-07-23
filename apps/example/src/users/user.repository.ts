import { Injectable } from '@grensesnitt/grain';

export interface User {
  id: number;
  name: string;
  email: string;
  passwordHash: string;
}

@Injectable()
export class UserRepository {
  private readonly users = new Map<number, User>();
  private nextId = 1;

  list(): User[] {
    return [...this.users.values()];
  }

  find(id: number): User | undefined {
    return this.users.get(id);
  }

  findByEmail(email: string): User | undefined {
    for (const user of this.users.values()) {
      if (user.email === email) return user;
    }
    return undefined;
  }

  insert(data: Omit<User, 'id'>): User {
    const user = { id: this.nextId++, ...data };
    this.users.set(user.id, user);
    return user;
  }

  delete(id: number): boolean {
    return this.users.delete(id);
  }
}
