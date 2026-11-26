package com.rsdp.officeproduct.importer.office.service;

import com.rsdp.officeproduct.importer.common.AccessDeniedException;
import com.rsdp.officeproduct.importer.common.GlobalExceptionHandler;
import com.rsdp.officeproduct.importer.office.controller.OfficeController;
import com.rsdp.officeproduct.importer.office.dto.ModuleRecommendationDto;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** 模块推荐/选品接口的项目成员权限校验：只读推荐要求 READ，选品要求 EDIT，且校验先于业务执行。 */
class OfficeControllerTest {

    private final OfficeService officeService = mock(OfficeService.class);
    private final OfficeProjectAccessService projectAccess = mock(OfficeProjectAccessService.class);
    private final OfficeModuleRecommendationService moduleRecommendations = mock(OfficeModuleRecommendationService.class);
    private final OfficeSpaceReviewService spaceReviewService = mock(OfficeSpaceReviewService.class);
    private final MockMvc mvc = MockMvcBuilders.standaloneSetup(
            new OfficeController(officeService, projectAccess, moduleRecommendations, spaceReviewService))
        .setControllerAdvice(new GlobalExceptionHandler()).build();

    @Test
    void moduleRecommendationsRequireReadAccessBeforeBusinessRuns() throws Exception {
        when(moduleRecommendations.recommend(anyString(), any())).thenReturn(new ModuleRecommendationDto());

        mvc.perform(post("/api/v1/office/projects/FLOOR-1/module-recommendations")
                .contentType(MediaType.APPLICATION_JSON).content("{}"))
            .andExpect(status().isOk());

        var order = inOrder(projectAccess, moduleRecommendations);
        order.verify(projectAccess).requireFloorAccess("FLOOR-1");
        order.verify(moduleRecommendations).recommend(anyString(), any());
    }

    @Test
    void moduleRecommendationsRejectMembersWithoutReadAccess() throws Exception {
        doThrow(new AccessDeniedException("无权访问该项目")).when(projectAccess).requireFloorAccess(anyString());

        mvc.perform(post("/api/v1/office/projects/FLOOR-1/module-recommendations")
                .contentType(MediaType.APPLICATION_JSON).content("{}"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.code").value(403));

        verifyNoInteractions(moduleRecommendations);
    }

    @Test
    void moduleProductSelectionStillRequiresEditPermission() throws Exception {
        when(moduleRecommendations.select(anyString(), any())).thenReturn(new ModuleRecommendationDto.Selection());

        mvc.perform(post("/api/v1/office/projects/FLOOR-1/module-products")
                .contentType(MediaType.APPLICATION_JSON).content("{}"))
            .andExpect(status().isOk());

        var order = inOrder(projectAccess, moduleRecommendations);
        order.verify(projectAccess).requireFloorPermission("FLOOR-1", OfficeProjectPermission.EDIT);
        order.verify(moduleRecommendations).select(anyString(), any());
    }
}
