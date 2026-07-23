import { Injectable } from '@grensesnitt/grain';

export interface User {
  id: number;
  name: string;
  email: string;
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

  insert(data: Omit<User, 'id'>): User {
    const user = { id: this.nextId++, ...data };
    this.users.set(user.id, user);
    return user;
  }

  delete(id: number): boolean {
    return this.users.delete(id);
  }
}
