import { Component, input } from '@angular/core';

@Component({
  selector: 'cms-navigation',
  template: `
    <nav>
      @for (child of data().navigationNode?.children ?? []; track child.uid) {
        <section>
          <h3>{{ child.title }}</h3>
          @for (entry of child.entries ?? []; track entry.itemId) {
            <a [href]="entry.url">{{ entry.linkName }}</a>
          }
        </section>
      }
    </nav>
  `,
})
export class NavigationComponent {
  data = input.required<any>();
}
