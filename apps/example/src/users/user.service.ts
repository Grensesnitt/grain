import { Injectable, NotFoundError } from '@grensesnitt/grain';
import { UserRepository, type User } from './user.repository';

@Injectable()
export class UserService {
  constructor(private readonly repo: UserRepository) {}

  list(): User[] {
    return this.repo.list();
  }

  find(id: number): User {
    const user = this.repo.find(id);
    if (!user) throw new NotFoundError(`user ${id} not found`);
    return user;
  }

  create(data: Omit<User, 'id'>): User {
    return this.repo.insert(data);
  }

  remove(id: number): void {
    if (!this.repo.delete(id)) throw new NotFoundError(`user ${id} not found`);
  }
}
