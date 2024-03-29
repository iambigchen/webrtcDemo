import { createRouter, createWebHashHistory } from 'vue-router'
import index from '../views/index.vue'

const router = createRouter({
    history: createWebHashHistory(),
    routes: [
        {
            "path": "/",
            "name": "index",
            "component": index
        }
    ],
})
export default router